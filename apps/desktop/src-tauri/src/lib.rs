mod ai;
mod export;
mod history;
mod language_tool;
mod latex;
mod memory_watch;
mod metadata;
mod project_import;
mod reference_sources;
mod texfmt;
mod uv;
mod zotero;

use std::path::Path;
use std::sync::Arc;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

use ai::registry::ProviderRegistry;
use ai::{AiProviderInfo, AiRequest, AiSessionInfo};

/// Entry point for the `--tectonic-compile` subprocess mode.
/// Runs tectonic compilation in an isolated process so that C-level global state
/// (font cache, etc.) is cleaned up on exit, preventing assertion failures on retry.
pub fn tectonic_compile_subprocess(
    work_dir: &Path,
    main_file: &str,
    single_pass: bool,
) -> Result<(), String> {
    latex::compile_with_tectonic(work_dir, main_file, single_pass)
}

// --- External editor detection & opening ---

#[derive(serde::Serialize, Clone)]
struct EditorInfo {
    id: String,
    name: String,
}

struct EditorDef {
    id: &'static str,
    name: &'static str,
    cli: &'static str,
}

const KNOWN_EDITORS: &[EditorDef] = &[
    EditorDef {
        id: "cursor",
        name: "Cursor",
        cli: "cursor",
    },
    EditorDef {
        id: "vscode",
        name: "VS Code",
        cli: "code",
    },
    EditorDef {
        id: "zed",
        name: "Zed",
        cli: "zed",
    },
    EditorDef {
        id: "sublime",
        name: "Sublime Text",
        cli: "subl",
    },
];

#[cfg(target_os = "macos")]
const MACOS_APP_PATHS: &[(&str, &str)] = &[
    ("cursor", "/Applications/Cursor.app"),
    ("vscode", "/Applications/Visual Studio Code.app"),
    ("zed", "/Applications/Zed.app"),
    ("sublime", "/Applications/Sublime Text.app"),
];

#[tauri::command]
fn detect_editors() -> Vec<EditorInfo> {
    KNOWN_EDITORS
        .iter()
        .filter(|e| is_editor_installed(e))
        .map(|e| EditorInfo {
            id: e.id.to_string(),
            name: e.name.to_string(),
        })
        .collect()
}

fn is_editor_installed(editor: &EditorDef) -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Some((_, app_path)) = MACOS_APP_PATHS.iter().find(|(id, _)| *id == editor.id) {
            return Path::new(app_path).exists();
        }
    }
    // Fallback / Windows / Linux: check if CLI is on PATH
    which::which(editor.cli).is_ok()
}

#[tauri::command]
fn open_in_editor(
    editor_id: String,
    project_path: String,
    file_path: Option<String>,
    line: Option<u32>,
) -> Result<(), String> {
    let editor = KNOWN_EDITORS
        .iter()
        .find(|e| e.id == editor_id)
        .ok_or_else(|| format!("Unknown editor: {}", editor_id))?;

    // On macOS, GUI apps don't inherit the shell's PATH, so CLI tools like
    // "code", "cursor", etc. won't be found. Use the login shell to resolve them.
    let cli_path = resolve_editor_cli(editor.cli)?;

    let mut cmd = std::process::Command::new(&cli_path);

    // Open the project folder
    cmd.arg(&project_path);

    // If a specific file is given, open it (with optional line number via -g)
    if let Some(ref fp) = file_path {
        let full_path = Path::new(&project_path).join(fp);
        if let Some(ln) = line {
            cmd.arg("-g");
            cmd.arg(format!("{}:{}", full_path.display(), ln));
        } else {
            cmd.arg(full_path);
        }
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to open {}: {}", editor.name, e))?;
    Ok(())
}

/// Reveal a file or folder in the OS file manager (Explorer / Finder / etc.).
/// Files are shown selected inside their parent folder; directories open directly.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let is_dir = p.is_dir();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        if is_dir {
            cmd.arg(&p);
        } else {
            // `/select,"<path>"` must be a single raw argument — the default
            // quoting splits it and Explorer opens the Documents folder instead.
            cmd.raw_arg(format!("/select,\"{}\"", p.display()));
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to open File Explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if is_dir {
            cmd.arg(&p);
        } else {
            cmd.arg("-R").arg(&p);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // xdg-open cannot select a file, so open the containing directory.
        let target = if is_dir {
            p.clone()
        } else {
            p.parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| p.clone())
        };
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

/// Open a file with the OS default application (system PDF viewer, image viewer, …).
#[tauri::command]
fn open_with_default_app(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["/C", "start", ""])
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

/// Resolve an editor CLI command to its full path.
/// On macOS, GUI apps lack the user's shell PATH, so we ask the login shell.
fn resolve_editor_cli(cli: &str) -> Result<String, String> {
    // First try the inherited PATH (works when launched from terminal)
    if let Ok(path) = which::which(cli) {
        return Ok(path.to_string_lossy().into_owned());
    }

    // On macOS, ask the login shell for the full PATH
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/bin/zsh")
            .args(["-l", "-c", &format!("which {}", cli)])
            .output()
            .map_err(|e| format!("Failed to resolve {}: {}", cli, e))?;
        if output.status.success() {
            let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !resolved.is_empty() && Path::new(&resolved).exists() {
                return Ok(resolved);
            }
        }
    }

    // Fallback: return bare name and hope for the best
    Ok(cli.to_string())
}

#[cfg(target_os = "macos")]
fn set_macos_app_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let icon_bytes = include_bytes!("../icons/icon.png");

    if let Some(mtm) = MainThreadMarker::new() {
        unsafe {
            let data = NSData::with_bytes(icon_bytes);
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                let app = NSApplication::sharedApplication(mtm);
                app.setApplicationIconImage(Some(&image));
            }
        }
    }
}

#[tauri::command]
fn create_new_window(app: tauri::AppHandle) -> Result<(), String> {
    let label = format!(
        "window-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Opal")
        .inner_size(1400.0, 900.0)
        .min_inner_size(800.0, 600.0)
        .visible(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(12.0, 12.0));
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}

#[tauri::command]
fn allow_project_directory(app: tauri::AppHandle, root_path: String) -> Result<(), String> {
    let fs_scope = app.fs_scope();
    fs_scope
        .allow_directory(&root_path, true)
        .map_err(|e| format!("Failed to allow project directory: {}", e))?;

    let asset_scope = app.state::<tauri::scope::Scopes>();
    asset_scope
        .allow_directory(&root_path, true)
        .map_err(|e| format!("Failed to allow project assets: {}", e))?;

    Ok(())
}

// --- Debug logging from JS (survives white-screen crashes) ---

#[tauri::command]
fn js_log(msg: String) {
    eprintln!("[js] {}", msg);
}

// --- Debug window ---

#[tauri::command]
fn open_debug_window(app: tauri::AppHandle) -> Result<(), String> {
    // If a debug window already exists, just focus it
    if let Some(win) = app.get_webview_window("debug") {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App("index.html?debug=1".into());
    WebviewWindowBuilder::new(&app, "debug", url)
        .title("Opal — Debug")
        .inner_size(560.0, 700.0)
        .min_inner_size(400.0, 400.0)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to create debug window: {}", e))?;

    Ok(())
}

// --- System info for debug panel & bug reports ---

#[derive(serde::Serialize)]
struct SystemInfo {
    os: String,
    os_version: String,
    arch: String,
    app_version: String,
}

#[tauri::command]
fn get_system_info(app: tauri::AppHandle) -> SystemInfo {
    // Get OS version from uname on unix, or fallback to "unknown"
    let os_version = {
        #[cfg(unix)]
        {
            std::process::Command::new("uname")
                .arg("-r")
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "unknown".to_string())
        }
        #[cfg(not(unix))]
        {
            "unknown".to_string()
        }
    };

    SystemInfo {
        os: std::env::consts::OS.to_string(),
        os_version,
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
    }
}

// --- Clipboard file paths (for Cmd+V paste in file tree) ---

#[tauri::command]
async fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(|| {
            let script = concat!(
                "set thePaths to \"\"\n",
                "try\n",
                "\tset theFiles to the clipboard as \u{00ab}class furl\u{00bb}\n",
                "\tset thePaths to POSIX path of theFiles\n",
                "on error\n",
                "\ttry\n",
                "\t\trepeat with f in (the clipboard as list)\n",
                "\t\t\ttry\n",
                "\t\t\t\tset thePaths to thePaths & POSIX path of (f as \u{00ab}class furl\u{00bb}) & linefeed\n",
                "\t\t\tend try\n",
                "\t\tend repeat\n",
                "\tend try\n",
                "end try\n",
                "return thePaths",
            );

            let output = std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output()
                .map_err(|e| e.to_string())?;

            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() {
                Ok(vec![])
            } else {
                Ok(stdout.lines().filter(|l| !l.is_empty()).map(|s| s.to_string()).collect())
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(vec![])
    }
}

// ─── AI Provider Commands ───

#[tauri::command]
async fn ai_list_providers(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
) -> Result<Vec<AiProviderInfo>, String> {
    Ok(registry.list_providers())
}

#[tauri::command]
async fn ai_get_active_provider(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
) -> Result<Option<String>, String> {
    Ok(registry.active_id().await)
}

#[tauri::command]
async fn ai_set_active_provider(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    provider_id: Option<String>,
) -> Result<(), String> {
    registry.set_active(provider_id).await;
    Ok(())
}

#[tauri::command]
async fn ai_status(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    provider_id: Option<String>,
) -> Result<AiProviderInfo, String> {
    let id = match provider_id {
        Some(id) => id,
        None => registry
            .active_id()
            .await
            .ok_or_else(|| "No AI provider configured".to_string())?,
    };

    let provider = registry
        .create_provider(&id)
        .ok_or_else(|| format!("Provider '{}' not found", id))?;
    Ok(provider.check_status().await)
}

#[tauri::command]
async fn ai_execute(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    request: AiRequest,
) -> Result<(), String> {
    let provider_id = registry
        .active_id()
        .await
        .ok_or_else(|| "No AI provider configured. Select one in Settings.".to_string())?;

    let provider = registry
        .create_provider(&provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    provider.execute(window, request).await
}

/// List the models available from a provider's API endpoint. Doubles as a
/// connection test: it makes a real authenticated request without spending
/// tokens.
#[tauri::command]
async fn ai_list_models(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    provider_id: Option<String>,
) -> Result<Vec<String>, String> {
    let id = match provider_id {
        Some(id) => id,
        None => registry
            .active_id()
            .await
            .ok_or_else(|| "No AI provider configured. Select one in Settings.".to_string())?,
    };

    let provider = registry
        .create_provider(&id)
        .ok_or_else(|| format!("Provider '{}' not found", id))?;

    provider.list_models().await
}

#[tauri::command]
async fn ai_cancel(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    tab_id: String,
) -> Result<(), String> {
    let provider_id = match registry.active_id().await {
        Some(id) => id,
        None => return Ok(()),
    };

    let provider = registry
        .create_provider(&provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    provider.cancel(&window, &tab_id).await
}

#[tauri::command]
async fn ai_list_sessions(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    project_path: String,
) -> Result<Vec<AiSessionInfo>, String> {
    let provider_id = match registry.active_id().await {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };

    let provider = registry
        .create_provider(&provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    provider.list_sessions(&project_path).await
}

#[tauri::command]
async fn ai_load_session(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    project_path: String,
    session_id: String,
) -> Result<Vec<ai::AiMessage>, String> {
    let provider_id = registry
        .active_id()
        .await
        .ok_or_else(|| "No AI provider configured".to_string())?;

    let provider = registry
        .create_provider(&provider_id)
        .ok_or_else(|| format!("Provider '{}' not found", provider_id))?;

    provider.load_session(&project_path, &session_id).await
}

// ─── API Key Management ───

fn get_env_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".tectonic").join(".env"))
}

#[tauri::command]
async fn ai_get_api_key(key_name: String) -> Result<Option<String>, String> {
    let path = get_env_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read: {}", e))?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == key_name {
                let val = v.trim().trim_matches('"').trim_matches('\'');
                return Ok(Some(val.to_string()));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
async fn ai_set_api_key(key_name: String, value: String) -> Result<(), String> {
    let path = get_env_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let mut content = if path.exists() {
        std::fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };

    let removing = value.is_empty();

    // Replace (or drop, when removing) an existing key
    let mut found = false;
    let new_lines: Vec<String> = content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return Some(line.to_string());
            }
            if let Some((k, _)) = trimmed.split_once('=') {
                if k.trim() == key_name {
                    found = true;
                    if removing {
                        return None; // drop the line entirely
                    }
                    return Some(format!("{}=\"{}\"", key_name, value));
                }
            }
            Some(line.to_string())
        })
        .collect();

    content = if found || removing {
        let mut joined = new_lines.join("\n");
        if !joined.is_empty() && !joined.ends_with('\n') {
            joined.push('\n');
        }
        joined
    } else {
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        format!("{}{}=\"{}\"\n", content, key_name, value)
    };

    std::fs::write(&path, content).map_err(|e| format!("Failed to write: {}", e))?;

    // Keep the current process environment in sync. An empty value must
    // remove the var — a set-but-empty key would make providers think a
    // key is configured.
    if removing {
        std::env::remove_var(&key_name);
    } else {
        std::env::set_var(&key_name, &value);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev builds: expose the WebView2 DevTools protocol so heap snapshots can
    // be taken from outside the app (leak diagnosis). Must be set before the
    // first WebView is created; an explicitly set variable wins.
    #[cfg(all(windows, debug_assertions))]
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--remote-debugging-port=9223",
        );
    }

    // Load .env file (walks up from cwd to find it)
    let _ = dotenvy::dotenv();

    // Load API keys saved from the settings UI (~/.tectonic/.env) so they
    // survive app restarts — ai_set_api_key writes here and sets the process
    // env var, but only for the current run.
    if let Ok(path) = get_env_path() {
        let _ = dotenvy::from_path(&path);
    }

    // Initialize AI provider registry
    let mut registry = ProviderRegistry::new();
    registry.register(
        || Box::new(ai::providers::anthropic::AnthropicProvider),
        AiProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic API".to_string(),
            ready: false,
            message: Some("Set ANTHROPIC_API_KEY to enable".to_string()),
        },
    );
    registry.register(
        || Box::new(ai::providers::openai::OpenAiProvider),
        AiProviderInfo {
            id: "openai".to_string(),
            name: "OpenAI API".to_string(),
            ready: false,
            message: Some("Set OPENAI_API_KEY to enable".to_string()),
        },
    );
    let registry = Arc::new(registry);

    #[allow(clippy::expect_used)]
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(latex::LatexCompilerState::default())
        .manage(zotero::ZoteroOAuthState::default())
        .manage(registry)
        .setup(|app| {
            // Safety net: force-show the main window after a timeout if the
            // frontend JS never calls `getCurrentWindow().show()`.
            // This prevents the window from staying permanently hidden when
            // WKWebView fails to execute JS (e.g. WebKit top-level-await bug
            // on macOS 12). See https://bugs.webkit.org/show_bug.cgi?id=242740
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        eprintln!("[safety] Main window still hidden after 8s, force-showing");
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            memory_watch::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_new_window,
            allow_project_directory,
            detect_editors,
            open_in_editor,
            reveal_in_file_manager,
            open_with_default_app,
            js_log,
            read_clipboard_file_paths,
            latex::compile_latex,
            latex::synctex_edit,
            latex::synctex_view,
            latex::synctex_view_batch,
            latex::detect_texlive,
            metadata::lookup_reference,
            metadata::search_references,
            metadata::clear_metadata_cache,
            project_import::import_zip_project,
            project_import::import_github_project,
            export::export_project_zip,
            export::get_default_reviewer_name,
            texfmt::format_latex,
            reference_sources::read_external_bibliography,
            reference_sources::fetch_citedrive_bibliography,
            // Unified AI provider commands
            ai_list_providers,
            ai_get_active_provider,
            ai_set_active_provider,
            ai_status,
            ai_execute,
            ai_cancel,
            ai_list_models,
            ai_list_sessions,
            ai_load_session,
            ai_get_api_key,
            ai_set_api_key,
            zotero::zotero_start_oauth,
            zotero::zotero_complete_oauth,
            zotero::zotero_cancel_oauth,
            zotero::zotero_local_request,
            language_tool::languagetool_check,
            history::history_init,
            history::history_snapshot,
            history::history_list,
            history::history_diff,
            history::history_file_at,
            history::history_restore,
            history::history_add_label,
            history::history_remove_label,
            uv::check_uv_status,
            uv::install_uv,
            uv::setup_project_venv,
            uv::uv_add_packages,
            uv::uv_run_python,
            uv::uv_cancel_python,
            get_system_info,
            open_debug_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            // Set the dock icon after the app is fully initialized.
            // Doing this in setup() causes SIGBUS on first launch from signed
            // binaries due to Gatekeeper App Translocation (#38).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Ready => {
                set_macos_app_icon();
            }
            // Workaround: WKWebView sometimes fails to repaint after the app
            // returns from background, leaving a black screen.  We apply two
            // complementary fixes on focus-restore:
            //   1. Nudge the window size by 1 px and back (forces native
            //      compositing layer to re-composite).
            //   2. Trigger a DOM reflow via JS (forces WKWebView render tree
            //      rebuild without losing app state).
            // Either one alone may not cover all cases.
            // See https://github.com/tauri-apps/tauri/issues/5226
            //     https://github.com/tauri-apps/tauri/issues/14843
            tauri::RunEvent::WindowEvent {
                ref label,
                event: tauri::WindowEvent::Focused(true),
                ..
            } => {
                if let Some(window) = app_handle.get_webview_window(label) {
                    // macOS: nudge window size to fix black screen after wake/focus
                    // See https://github.com/tauri-apps/tauri/issues/5226
                    #[cfg(target_os = "macos")]
                    {
                        if let Ok(size) = window.inner_size() {
                            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                                width: size.width + 1,
                                height: size.height,
                            }));
                            let _ = window.set_size(tauri::Size::Physical(size));
                        }
                        let _ = window.eval(
                            "document.body.style.display='none';\
                             document.body.offsetHeight;\
                             document.body.style.display='';",
                        );
                    }
                    let _ = window.emit("window-focus-restored", ());
                }
            }
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                // Quit the app when the last window is closed
                if app_handle.webview_windows().is_empty() {
                    app_handle.exit(0);
                }
            }
            tauri::RunEvent::ExitRequested { .. } => {
                // Clean up LaTeX build temp directories
                let latex_state = app_handle.state::<latex::LatexCompilerState>();
                let state_clone = latex_state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    latex::cleanup_all_builds(&state_clone).await;
                });
            }
            _ => {}
        }
    });
}
