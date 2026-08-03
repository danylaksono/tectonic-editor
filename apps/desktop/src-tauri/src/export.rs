use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Directories that never belong in a shared project archive. `.venv` is here
/// because a Python environment is large, machine-specific, and rebuildable —
/// the recipient runs `uv` rather than unpacking the sender's binaries.
const EXCLUDED_DIRECTORIES: &[&str] = &[".git", "node_modules", ".venv", "venv", "__pycache__"];
/// The app's private folder is excluded except for compiled artifacts the
/// reviewer needs (the PDF the annotations were made against, plus SyncTeX
/// data so "go to source" keeps working on the receiving side).
const APP_DIRECTORY: &str = ".tectonic-editor";

/// Default reviewer identity: git user.name if configured, else OS username.
#[tauri::command]
pub fn get_default_reviewer_name() -> String {
    if let Ok(config) = git2::Config::open_default() {
        if let Ok(name) = config.get_string("user.name") {
            let name = name.trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub file_count: usize,
    pub zip_path: String,
}

/// Pack the project (sources + review/ + compiled PDF/SyncTeX) into a zip so
/// it can be sent to peers and reopened with annotations intact.
#[tauri::command]
pub async fn export_project_zip(
    project_root: String,
    destination: String,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&project_root);
        if !root.is_dir() {
            return Err(format!("Project folder not found: {project_root}"));
        }
        let destination = PathBuf::from(&destination);

        let file = File::create(&destination)
            .map_err(|error| format!("Could not create archive: {error}"))?;
        let mut writer = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let mut files = Vec::new();
        collect_files(&root, &root, &destination, &mut files)
            .map_err(|error| format!("Could not read project files: {error}"))?;
        files.sort();

        let mut buffer = Vec::new();
        for relative in &files {
            let name = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            writer
                .start_file(&name, options)
                .map_err(|error| format!("Could not write {name}: {error}"))?;
            let mut source = File::open(root.join(relative))
                .map_err(|error| format!("Could not open {name}: {error}"))?;
            buffer.clear();
            source
                .read_to_end(&mut buffer)
                .map_err(|error| format!("Could not read {name}: {error}"))?;
            writer
                .write_all(&buffer)
                .map_err(|error| format!("Could not write {name}: {error}"))?;
        }

        writer
            .finish()
            .map_err(|error| format!("Could not finish archive: {error}"))?;

        Ok(ExportResult {
            file_count: files.len(),
            zip_path: destination.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?
}

fn collect_files(
    root: &Path,
    directory: &Path,
    destination: &Path,
    files: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            if EXCLUDED_DIRECTORIES.contains(&name.as_str()) {
                continue;
            }
            if name == APP_DIRECTORY && path.parent() == Some(root) {
                collect_build_artifacts(root, &path, files);
                continue;
            }
            collect_files(root, &path, destination, files)?;
        } else if file_type.is_file() {
            // Never pack the archive into itself.
            if path == destination {
                continue;
            }
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_path_buf());
            }
        }
    }
    Ok(())
}

/// From .tectonic-editor keep only build/*.pdf and build/*.synctex.gz.
fn collect_build_artifacts(root: &Path, app_directory: &Path, files: &mut Vec<PathBuf>) {
    let build = app_directory.join("build");
    let Ok(entries) = fs::read_dir(&build) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let keep = name.ends_with(".pdf") || name.ends_with(".synctex.gz");
        if keep {
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_path_buf());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::ZipArchive;

    fn write_file(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn packs_sources_review_and_build_pdf_only() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write_file(&root.join("main.tex"), "\\documentclass{article}");
        write_file(&root.join("review/dany.json"), "{}");
        write_file(&root.join(".git/HEAD"), "ref: refs/heads/main");
        write_file(&root.join(".tectonic-editor/build/main.pdf"), "%PDF-1.5");
        write_file(
            &root.join(".tectonic-editor/build/main.synctex.gz"),
            "synctex",
        );
        write_file(&root.join(".tectonic-editor/build/main.log"), "log");
        write_file(&root.join(".tectonic-editor/settings.json"), "{}");

        let destination = root.join("export.zip");
        let result = tauri::async_runtime::block_on(export_project_zip(
            root.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
        ))
        .unwrap();

        let bytes = fs::read(&destination).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                ".tectonic-editor/build/main.pdf",
                ".tectonic-editor/build/main.synctex.gz",
                "main.tex",
                "review/dany.json",
            ]
        );
        assert_eq!(result.file_count, 4);
    }

    #[test]
    fn omits_python_environments() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        write_file(&root.join("main.tex"), "\\documentclass{article}");
        write_file(&root.join("analysis.py"), "print('keep me')");
        // A venv is large, machine-specific and rebuildable — never shipped.
        write_file(&root.join(".venv/pyvenv.cfg"), "home = /usr/bin");
        write_file(&root.join(".venv/lib/site-packages/numpy/__init__.py"), "x");
        write_file(&root.join("__pycache__/analysis.cpython-313.pyc"), "bytes");

        let destination = root.join("export.zip");
        tauri::async_runtime::block_on(export_project_zip(
            root.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
        ))
        .unwrap();

        let bytes = fs::read(&destination).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        // The script is source and stays; the environment it needs does not.
        assert_eq!(names, vec!["analysis.py", "main.tex"]);
    }
}
