//! Renderer memory watchdog.
//!
//! The frontend's own guard can only read `performance.memory`, which reports
//! the V8 JS heap — the July 2026 OOM dumps showed the renderer dying from
//! PartitionAlloc and WASM memory that number never reflects, so the renderer
//! climbed from 2 GB to 18 GB of commit without any signal the page could see.
//! The authoritative number has to come from outside the WebView: poll the OS
//! for this process's descendants (the WebView renderer among them) and stream
//! their memory use to the frontend, which owns the thresholds and shedding.

use std::collections::HashMap;
use std::time::Duration;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryStats {
    /// Largest commit among descendant processes — in practice the WebView
    /// renderer, the process that OOMs.
    renderer_bytes: u64,
    /// This process plus every descendant.
    total_bytes: u64,
    process_count: usize,
}

const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Best available "how close is this process to OOM" number. Windows reports
/// commit charge (`PrivateUsage`) as `virtual_memory`, which is what the OS
/// kills on; elsewhere virtual size is address space (meaningless for this),
/// so fall back to resident set.
fn commit_bytes(proc: &sysinfo::Process) -> u64 {
    #[cfg(windows)]
    {
        proc.memory().max(proc.virtual_memory())
    }
    #[cfg(not(windows))]
    {
        proc.memory()
    }
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let self_pid = Pid::from_u32(std::process::id());
        let mut sys = System::new();
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_memory(),
            );

            let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
            for (pid, proc) in sys.processes() {
                if let Some(parent) = proc.parent() {
                    children.entry(parent).or_default().push(*pid);
                }
            }

            let mut descendants: Vec<Pid> = Vec::new();
            let mut stack = vec![self_pid];
            while let Some(pid) = stack.pop() {
                if let Some(kids) = children.get(&pid) {
                    for kid in kids {
                        descendants.push(*kid);
                        stack.push(*kid);
                    }
                }
            }

            let renderer_bytes = descendants
                .iter()
                .filter_map(|pid| sys.process(*pid))
                .map(commit_bytes)
                .max()
                .unwrap_or(0);
            let total_bytes = std::iter::once(self_pid)
                .chain(descendants.iter().copied())
                .filter_map(|pid| sys.process(pid))
                .map(commit_bytes)
                .sum();

            let _ = app.emit(
                "memory-stats",
                MemoryStats {
                    renderer_bytes,
                    total_bytes,
                    process_count: descendants.len() + 1,
                },
            );
        }
    });
}
