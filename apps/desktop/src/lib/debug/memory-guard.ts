import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { createLogger } from "@/lib/debug/logger";
import { useSettingsStore } from "@/stores/settings-store";
import { getMupdfClient, resetMupdfClient } from "@/lib/mupdf/mupdf-client";
import { dropDocCache } from "@/lib/mupdf/pdf-doc-cache";

const log = createLogger("memory-guard");

/** Dispatched on window after the MuPDF worker has been force-restarted: every
 * cached docId is dead and viewers must reopen their documents. */
export const MUPDF_CLIENT_RESET = "opal:mupdf-client-reset";

/** JS heap usage (bytes) above which the preview auto-degrades. The renderer
 * OOMs somewhere past ~2-4 GB depending on WASM/canvas residency, so degrade
 * well before that while there is still headroom to recover. */
const HEAP_PRESSURE_BYTES = 1200 * 1024 * 1024;

/** Also degrade when usage approaches the engine's own ceiling, whichever
 * comes first — jsHeapSizeLimit varies per machine. */
const HEAP_LIMIT_RATIO = 0.6;

const CHECK_INTERVAL_MS = 10_000;
/** Throttle repeated high-memory log entries. */
const LOG_THROTTLE_MS = 60_000;

// --- Process-level watchdog (fed by the Rust `memory-stats` event) ---
//
// performance.memory only sees the V8 JS heap. The 2026-07-29 OOM crash dump
// showed the renderer at 17.9 GB commit — 15 GB PartitionAlloc + 2.4 GB WASM —
// while the JS heap stayed small, so the guard above never fired. The backend
// polls real process memory and streams it here; these tiers shed load before
// the OS kills the renderer.

/** Trim MuPDF's store and degrade the preview. */
const RENDERER_SOFT_BYTES = 3.5 * 1024 * 1024 * 1024;
/** Restart the MuPDF worker (frees the whole WASM heap) and reopen documents. */
const RENDERER_HARD_BYTES = 7 * 1024 * 1024 * 1024;
const SOFT_ACTION_THROTTLE_MS = 60_000;
const HARD_ACTION_THROTTLE_MS = 180_000;

interface MemoryStatsEvent {
  rendererBytes: number;
  totalBytes: number;
  processCount: number;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function readHeap(): PerformanceMemory | null {
  const memory = (performance as Performance & { memory?: PerformanceMemory })
    .memory;
  return memory && memory.usedJSHeapSize > 0 ? memory : null;
}

let started = false;
let autoDegradedThisSession = false;
let lastHighLogAt = 0;
let lastSoftActionAt = 0;
let lastHardActionAt = 0;

/** Latest process stats, for the debug page / log inspection. */
export let lastMemoryStats: MemoryStatsEvent | null = null;

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** Switch to Lightweight PDF preview once per session, with a toast. */
function degradePreview(reasonMb: number, source: string): void {
  const settings = useSettingsStore.getState();
  if (settings.simplePdfPreview || autoDegradedThisSession) return;

  autoDegradedThisSession = true;
  settings.setSimplePdfPreview(true);
  log.warn("Auto-enabled Lightweight PDF preview due to memory pressure", {
    usedMb: reasonMb,
    source,
  });
  toast.warning("Switched to Lightweight PDF preview", {
    id: "memory-guard-degrade",
    duration: 10_000,
    description: `Memory use was getting high (${reasonMb} MB) — the preview now renders in lightweight mode to prevent a crash. You can turn this off in Settings.`,
  });
}

function onMemoryStats(stats: MemoryStatsEvent): void {
  lastMemoryStats = stats;
  const now = Date.now();

  if (stats.rendererBytes > RENDERER_HARD_BYTES) {
    if (now - lastHardActionAt < HARD_ACTION_THROTTLE_MS) return;
    lastHardActionAt = now;
    log.error("Renderer memory critical — restarting PDF engine", {
      rendererMb: mb(stats.rendererBytes),
      totalMb: mb(stats.totalBytes),
    });
    degradePreview(mb(stats.rendererBytes), "process-watchdog");
    // Order matters: drop the docId table first (the ids die with the worker),
    // then terminate, then tell viewers to reopen through a fresh worker.
    dropDocCache();
    resetMupdfClient();
    window.dispatchEvent(new CustomEvent(MUPDF_CLIENT_RESET));
    toast.warning("PDF engine restarted to free memory", {
      id: "memory-guard-reset",
      duration: 10_000,
      description: `The app was using ${mb(stats.rendererBytes)} MB and was about to crash. The preview reloads automatically. If this repeats, please report it.`,
    });
    return;
  }

  if (stats.rendererBytes > RENDERER_SOFT_BYTES) {
    if (now - lastSoftActionAt < SOFT_ACTION_THROTTLE_MS) return;
    lastSoftActionAt = now;
    log.warn("Renderer memory high — trimming MuPDF store", {
      rendererMb: mb(stats.rendererBytes),
      totalMb: mb(stats.totalBytes),
    });
    getMupdfClient()
      .trimStore(50)
      .catch(() => {});
    degradePreview(mb(stats.rendererBytes), "process-watchdog");
  }
}

/** Start the background memory monitors (idempotent): the JS-heap sampler and
 * the process-level watchdog fed by the backend. A safety net against renderer
 * OOM crashes — degrades the preview early and force-restarts the PDF engine
 * before the OS kills the renderer. */
export function startMemoryGuard(): void {
  if (started) return;
  started = true;

  void listen<MemoryStatsEvent>("memory-stats", (event) => {
    onMemoryStats(event.payload);
  }).catch((error) => {
    log.debug("Process memory stats unavailable", { error: String(error) });
  });

  const memory = readHeap();
  if (!memory) {
    log.debug("performance.memory unavailable — JS heap guard disabled");
    return;
  }

  setInterval(() => {
    const heap = readHeap();
    if (!heap) return;

    const used = heap.usedJSHeapSize;
    const pressured =
      used > HEAP_PRESSURE_BYTES ||
      used > heap.jsHeapSizeLimit * HEAP_LIMIT_RATIO;
    if (!pressured) return;

    const usedMb = mb(used);
    const now = Date.now();
    if (now - lastHighLogAt > LOG_THROTTLE_MS) {
      lastHighLogAt = now;
      log.warn("High JS heap usage", {
        usedMb,
        limitMb: mb(heap.jsHeapSizeLimit),
      });
    }

    degradePreview(usedMb, "js-heap");
  }, CHECK_INTERVAL_MS);
}
