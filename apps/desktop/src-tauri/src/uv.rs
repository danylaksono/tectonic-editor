use std::path::PathBuf;
use tauri::{Emitter, WebviewWindow};
use tokio::io::{AsyncBufReadExt, BufReader};

/// Windows CREATE_NO_WINDOW flag to prevent console windows from flashing
/// when spawning child processes (e.g. uv, powershell, python).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Check if an environment variable should be explicitly passed to child processes.
///
/// NOTE: This is NOT a true whitelist — we do NOT call `env_clear()`, so the
/// child inherits the full parent environment.  This helper only identifies vars
/// that we *explicitly* re-set via `cmd.env()` to guarantee they are present
/// even when other per-key overrides are applied (e.g. prepending to PATH).
/// Uses case-insensitive comparison for Windows compatibility.
pub(crate) fn is_essential_env_var(key: &str) -> bool {
    let k = key.to_ascii_uppercase();
    // Cross-platform
    matches!(
        k.as_str(),
        "HOME" | "USER" | "SHELL" | "LANG"
        | "HOMEBREW_PREFIX" | "HOMEBREW_CELLAR"
        | "HTTP_PROXY" | "HTTPS_PROXY" | "NO_PROXY" | "ALL_PROXY"
    ) || k.starts_with("LC_")
    // Windows-specific
    || matches!(
        k.as_str(),
        "USERPROFILE" | "APPDATA" | "LOCALAPPDATA"
        | "TEMP" | "TMP"
        | "SYSTEMROOT" | "SYSTEMDRIVE"
        | "COMPUTERNAME" | "USERNAME"
        | "PROGRAMFILES" | "PROGRAMFILES(X86)" | "COMMONPROGRAMFILES"
        | "PATHEXT" | "PSMODULEPATH" | "WINDIR"
    )
}

// ─── Binary Discovery ───

/// Discover the uv binary on the system.
/// Checks: which → cargo bin → standard paths → bare fallback.
fn find_uv_binary() -> Result<String, String> {
    // 1. Try to find uv on PATH
    if let Ok(path) = which::which("uv") {
        return Ok(path.to_string_lossy().to_string());
    }

    // 2. Check user-specific paths
    if let Some(home) = dirs::home_dir() {
        #[cfg(not(target_os = "windows"))]
        let user_paths = vec![
            home.join(".cargo").join("bin").join("uv"),
            home.join(".local").join("bin").join("uv"),
        ];
        #[cfg(target_os = "windows")]
        let user_paths = vec![
            // uv's default install location (same as Claude Code)
            home.join(".local").join("bin").join("uv.exe"),
            home.join(".cargo").join("bin").join("uv.exe"),
            // %LOCALAPPDATA%\uv\bin\uv.exe
            PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
                home.join("AppData")
                    .join("Local")
                    .to_string_lossy()
                    .to_string()
            }))
            .join("uv")
            .join("bin")
            .join("uv.exe"),
        ];

        for path in &user_paths {
            if path.exists() {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }

    // 3. Check standard paths (Unix only)
    #[cfg(not(target_os = "windows"))]
    {
        let standard_paths = ["/usr/local/bin/uv", "/opt/homebrew/bin/uv", "/usr/bin/uv"];
        for path in &standard_paths {
            if PathBuf::from(path).exists() {
                return Ok(path.to_string());
            }
        }
    }

    // 4. Bare fallback — hope it's in PATH
    Ok("uv".to_string())
}

// ─── Status Types ───

#[derive(serde::Serialize)]
pub struct UvStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
}

#[derive(serde::Serialize)]
pub struct VenvInfo {
    pub venv_path: String,
    pub python_path: String,
    pub created: bool,
}

#[derive(serde::Serialize)]
pub struct PythonRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    /// The script exceeded its time budget and was killed.
    pub timed_out: bool,
    /// `uv_cancel_python` was called for this run.
    pub cancelled: bool,
    /// Output exceeded `OUTPUT_CAP_BYTES` and what is returned is partial.
    pub truncated: bool,
    /// Where the executed script was written, so the user can inspect it.
    pub script_path: String,
}

// ─── Script execution limits ───

const DEFAULT_RUN_TIMEOUT_SECS: u64 = 60;
const MAX_RUN_TIMEOUT_SECS: u64 = 600;
/// Retained per stream. Small on purpose: this text ends up in the model's
/// context, and an unbounded buffer is how the 1.4.7 OOM happened.
const OUTPUT_CAP_BYTES: usize = 32 * 1024;

/// Cancellation channels for in-flight scripts, keyed by the caller's run id.
fn running_scripts(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>
{
    static RUNNING: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    > = std::sync::OnceLock::new();
    RUNNING.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// FNV-1a. Identical code maps to the same script file, so re-running something
/// unchanged does not litter the scripts directory.
fn content_hash(code: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in code.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", hash)
}

/// Drain a stream, keeping at most `cap` bytes. Reading continues past the cap
/// so the child never blocks writing into a full pipe — the excess is simply
/// not retained.
async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut reader: R, cap: usize) -> (String, bool) {
    use tokio::io::AsyncReadExt;

    let mut kept: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;

    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                if kept.len() < cap {
                    let take = std::cmp::min(n, cap - kept.len());
                    kept.extend_from_slice(&chunk[..take]);
                    if take < n {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }

    (String::from_utf8_lossy(&kept).to_string(), truncated)
}

// ─── Helper: build PATH with venv bin prepended ───

fn venv_bin_dir(venv_dir: &std::path::Path) -> PathBuf {
    #[cfg(not(target_os = "windows"))]
    {
        venv_dir.join("bin")
    }
    #[cfg(target_os = "windows")]
    {
        venv_dir.join("Scripts")
    }
}

fn venv_python(venv_dir: &std::path::Path) -> PathBuf {
    #[cfg(not(target_os = "windows"))]
    {
        venv_bin_dir(venv_dir).join("python")
    }
    #[cfg(target_os = "windows")]
    {
        venv_bin_dir(venv_dir).join("python.exe")
    }
}

fn path_with_venv(venv_dir: &std::path::Path) -> String {
    let bin = venv_bin_dir(venv_dir);
    let current = std::env::var("PATH").unwrap_or_default();
    #[cfg(target_os = "windows")]
    let sep = ";";
    #[cfg(not(target_os = "windows"))]
    let sep = ":";
    format!("{}{}{}", bin.to_string_lossy(), sep, current)
}

// ─── Tauri Commands ───

#[tauri::command]
pub async fn check_uv_status() -> Result<UvStatus, String> {
    let binary_path = match find_uv_binary() {
        Ok(path) => path,
        Err(_) => {
            return Ok(UvStatus {
                installed: false,
                binary_path: None,
                version: None,
            });
        }
    };

    // Verify binary actually works by running --version
    let mut version_cmd = std::process::Command::new(&binary_path);
    version_cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        version_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let version_output = version_cmd.output();

    let version = match version_output {
        Ok(output) if output.status.success() => {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        _ => {
            return Ok(UvStatus {
                installed: false,
                binary_path: None,
                version: None,
            });
        }
    };

    Ok(UvStatus {
        installed: true,
        binary_path: Some(binary_path),
        version,
    })
}

#[tauri::command]
pub async fn install_uv(window: WebviewWindow) -> Result<(), String> {
    // Ensure ~/.local/bin exists — uv installs its binary there.
    // If ~/.local is owned by root (e.g. created by pip), prompt for admin password.
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin");
        if std::fs::create_dir_all(&local_bin).is_err() {
            let user = std::env::var("USER").unwrap_or_default();
            let local_dir = home.join(".local");
            let script = format!(
                "mkdir -p '{}' && chown -R {} '{}'",
                local_bin.display(),
                user,
                local_dir.display()
            );
            let output = std::process::Command::new("osascript")
                .args([
                    "-e",
                    &format!(
                        "do shell script \"{}\" with administrator privileges",
                        script
                    ),
                ])
                .output()
                .map_err(|e| format!("Failed to fix permissions for ~/.local: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "Failed to create ~/.local/bin: {}. \
                     Please run: sudo chown -R $(whoami) ~/.local",
                    stderr.trim()
                ));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("bash");
        c.args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = tokio::process::Command::new("powershell");
        c.creation_flags(CREATE_NO_WINDOW);
        c.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://astral.sh/uv/install.ps1 | iex",
        ]);
        c
    };

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // Inherit essential environment variables (shared helper handles case-insensitive matching)
    for (key, value) in std::env::vars() {
        if key.eq_ignore_ascii_case("PATH") || is_essential_env_var(&key) {
            cmd.env(&key, &value);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run uv installer: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    // Stream stdout
    let win_stdout = window.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_stdout.emit("uv-install-output", &line);
        }
    });

    // Stream stderr
    let win_stderr = window.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_stderr.emit("uv-install-output", &line);
        }
    });

    // Wait for completion
    let win_complete = window;
    tokio::spawn(async move {
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        let success = match child.wait().await {
            Ok(status) => status.success(),
            Err(_) => false,
        };

        let _ = win_complete.emit("uv-install-complete", success);
    });

    Ok(())
}

#[tauri::command]
pub async fn setup_project_venv(project_path: String) -> Result<VenvInfo, String> {
    let project = std::path::Path::new(&project_path);
    let venv_dir = project.join(".venv");

    // If venv already exists, just return info
    if venv_dir.exists() {
        let python = venv_python(&venv_dir);
        return Ok(VenvInfo {
            venv_path: venv_dir.to_string_lossy().to_string(),
            python_path: python.to_string_lossy().to_string(),
            created: false,
        });
    }

    let uv_bin = find_uv_binary().map_err(|e| format!("uv not found: {}", e))?;

    // Create venv: uv venv <project_path>/.venv
    let mut venv_cmd = tokio::process::Command::new(&uv_bin);
    venv_cmd.args(["venv", &venv_dir.to_string_lossy()]);
    venv_cmd.current_dir(project);
    #[cfg(target_os = "windows")]
    {
        venv_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = venv_cmd
        .output()
        .await
        .map_err(|e| format!("Failed to create venv: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("uv venv failed: {}", stderr));
    }

    let python = venv_python(&venv_dir);

    Ok(VenvInfo {
        venv_path: venv_dir.to_string_lossy().to_string(),
        python_path: python.to_string_lossy().to_string(),
        created: true,
    })
}

#[tauri::command]
pub async fn uv_add_packages(
    packages: Vec<String>,
    project_path: String,
) -> Result<String, String> {
    let uv_bin = find_uv_binary().map_err(|e| format!("uv not found: {}", e))?;
    let venv_dir = std::path::Path::new(&project_path).join(".venv");

    if !venv_dir.exists() {
        return Err("No .venv found. Run setup_project_venv first.".to_string());
    }

    let mut args = vec!["pip".to_string(), "install".to_string()];
    args.extend(packages);

    let mut pip_cmd = tokio::process::Command::new(&uv_bin);
    pip_cmd.args(&args);
    pip_cmd.current_dir(&project_path);
    pip_cmd.env("VIRTUAL_ENV", &venv_dir);
    pip_cmd.env("PATH", path_with_venv(&venv_dir));
    #[cfg(target_os = "windows")]
    {
        pip_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = pip_cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run uv pip install: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("uv pip install failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Run a Python script in the project's virtual environment.
///
/// This replaces the former `uv_run_command`, which took a command *string*,
/// split it on whitespace and executed the first token as a program — that was
/// arbitrary command execution with no timeout, no output limit and no way to
/// cancel. Taking the code itself instead means:
///
/// - nothing but the venv's Python is ever executed;
/// - quoting is a non-issue, since no shell string is built;
/// - the script is written to `.tectonic-editor/scripts/` so the user can see
///   exactly what ran.
///
/// The child is killed on timeout or when `uv_cancel_python` is called with the
/// same `run_id`, and each stream is retained only up to `OUTPUT_CAP_BYTES`
/// (draining continues past the cap so the child never blocks on a full pipe).
#[tauri::command]
pub async fn uv_run_python(
    code: String,
    project_path: String,
    run_id: String,
    timeout_secs: Option<u64>,
) -> Result<PythonRunResult, String> {
    let project = std::path::Path::new(&project_path);
    let venv_dir = project.join(".venv");
    if !venv_dir.exists() {
        return Err("No .venv found. Run setup_project_venv first.".to_string());
    }

    let scripts_dir = project.join(".tectonic-editor").join("scripts");
    std::fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create scripts directory: {}", e))?;

    let script_path = scripts_dir.join(format!("{}.py", content_hash(&code)));
    std::fs::write(&script_path, &code).map_err(|e| format!("Failed to write script: {}", e))?;

    let timeout = std::time::Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_RUN_TIMEOUT_SECS)
            .clamp(1, MAX_RUN_TIMEOUT_SECS),
    );

    let mut command = tokio::process::Command::new(venv_python(&venv_dir));
    command
        .arg(&script_path)
        .current_dir(project)
        .env("VIRTUAL_ENV", &venv_dir)
        .env("PATH", path_with_venv(&venv_dir))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start Python: {}", e))?;

    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let out_task = tokio::spawn(read_capped(stdout, OUTPUT_CAP_BYTES));
    let err_task = tokio::spawn(read_capped(stderr, OUTPUT_CAP_BYTES));

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    running_scripts()
        .lock()
        .map_err(|_| "run registry poisoned")?
        .insert(run_id.clone(), cancel_tx);

    let mut timed_out = false;
    let mut cancelled = false;

    let status = tokio::select! {
        result = child.wait() => result.map_err(|e| format!("Failed to wait: {}", e))?,
        _ = tokio::time::sleep(timeout) => {
            timed_out = true;
            let _ = child.kill().await;
            child.wait().await.map_err(|e| format!("Failed to wait after timeout: {}", e))?
        }
        _ = cancel_rx => {
            cancelled = true;
            let _ = child.kill().await;
            child.wait().await.map_err(|e| format!("Failed to wait after cancel: {}", e))?
        }
    };

    running_scripts()
        .lock()
        .map_err(|_| "run registry poisoned")?
        .remove(&run_id);

    let (stdout_text, out_truncated) = out_task.await.map_err(|e| e.to_string())?;
    let (stderr_text, err_truncated) = err_task.await.map_err(|e| e.to_string())?;

    Ok(PythonRunResult {
        stdout: stdout_text,
        stderr: stderr_text,
        exit_code: status.code().unwrap_or(-1),
        timed_out,
        cancelled,
        truncated: out_truncated || err_truncated,
        script_path: script_path.to_string_lossy().to_string(),
    })
}

/// Kill an in-flight script. Returns false when the id is unknown, which is the
/// normal outcome for a run that finished between the UI deciding to cancel and
/// the call arriving.
#[tauri::command]
pub fn uv_cancel_python(run_id: String) -> bool {
    let Ok(mut running) = running_scripts().lock() else {
        return false;
    };
    match running.remove(&run_id) {
        Some(sender) => sender.send(()).is_ok(),
        None => false,
    }
}
