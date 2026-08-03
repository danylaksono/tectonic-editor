import { create } from "zustand";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("pending-scripts");

/**
 * Consent gate for `run_python`.
 *
 * Executing code is a larger action than editing a file, so it gets at least
 * the same treatment as `propose_edit`: the assistant proposes, the user
 * decides. The difference is that the model needs the script's *output* to
 * continue, so the tool call blocks here until the user answers rather than
 * returning "proposed" and ending the turn.
 */

/** How long a request waits before giving up and reporting no response. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type ScriptDecision = "approved" | "rejected" | "timeout";

export interface PendingScript {
  /** The tool_use_id of the call that requested it. */
  id: string;
  code: string;
  description: string;
  createdAt: number;
}

interface PendingScriptsState {
  pending: PendingScript[];
  /**
   * Script bodies the user already approved in this session. Re-running
   * byte-identical code does not re-prompt, so an agent loop that retries the
   * same script is not death by dialog — but any edit to the code is a new
   * decision.
   */
  approvedCode: string[];
  /** Set from the gallery/settings: skip the prompt for this project entirely. */
  autoApprove: boolean;

  setAutoApprove: (value: boolean) => void;
  /** Ask the user. Resolves when they decide, or on timeout. */
  request: (script: PendingScript) => Promise<ScriptDecision>;
  approve: (id: string) => void;
  reject: (id: string) => void;
  /** Reject everything still waiting — used when a chat turn is cancelled. */
  rejectAll: () => void;
}

/** Resolvers for in-flight requests, keyed by id. Deliberately outside the
 *  store: they are callbacks, not state to render. */
const waiting = new Map<
  string,
  { resolve: (d: ScriptDecision) => void; timer: ReturnType<typeof setTimeout> }
>();

function settle(id: string, decision: ScriptDecision) {
  const entry = waiting.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  waiting.delete(id);
  entry.resolve(decision);
}

export const usePendingScriptsStore = create<PendingScriptsState>()(
  (set, get) => ({
    pending: [],
    approvedCode: [],
    autoApprove: false,

    setAutoApprove: (value) => set({ autoApprove: value }),

    request: (script) => {
      const state = get();

      // Already approved this exact code, or the user turned the prompt off
      if (state.autoApprove || state.approvedCode.includes(script.code)) {
        log.debug("auto-approved", { id: script.id });
        return Promise.resolve<ScriptDecision>("approved");
      }

      set((s) => ({ pending: [...s.pending, script] }));

      return new Promise<ScriptDecision>((resolve) => {
        const timer = setTimeout(() => {
          log.info("approval timed out", { id: script.id });
          set((s) => ({
            pending: s.pending.filter((p) => p.id !== script.id),
          }));
          settle(script.id, "timeout");
        }, APPROVAL_TIMEOUT_MS);

        waiting.set(script.id, { resolve, timer });
      });
    },

    approve: (id) => {
      const script = get().pending.find((p) => p.id === id);
      set((s) => ({
        pending: s.pending.filter((p) => p.id !== id),
        approvedCode: script
          ? [...s.approvedCode, script.code]
          : s.approvedCode,
      }));
      settle(id, "approved");
    },

    reject: (id) => {
      set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
      settle(id, "rejected");
    },

    rejectAll: () => {
      const ids = get().pending.map((p) => p.id);
      set({ pending: [] });
      for (const id of ids) settle(id, "rejected");
    },
  }),
);
