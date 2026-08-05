import { create } from "zustand";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("pending-approvals");

/**
 * Consent gate for the tools that act outside the document: `run_python` and
 * `install_python_packages`.
 *
 * Executing code is a larger action than editing a file, so it gets at least
 * the same treatment as `propose_edit`: the assistant proposes, the user
 * decides. The difference is that the model needs the result to continue, so
 * the tool call blocks here until the user answers rather than returning
 * "proposed" and ending the turn.
 */

/** How long a request waits before giving up and reporting no response. */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type ApprovalDecision = "approved" | "rejected" | "timeout";

interface ApprovalBase {
  /** The tool_use_id of the call that requested it. */
  id: string;
  createdAt: number;
}

export interface ScriptApproval extends ApprovalBase {
  kind: "script";
  code: string;
  description: string;
}

export interface PackagesApproval extends ApprovalBase {
  kind: "packages";
  packages: string[];
  reason: string;
}

export type PendingApproval = ScriptApproval | PackagesApproval;

interface PendingApprovalsState {
  pending: PendingApproval[];
  /**
   * Script bodies the user already approved in this session. Re-running
   * byte-identical code does not re-prompt, so an agent loop that retries the
   * same script is not death by dialog — but any edit to the code is a new
   * decision. Package installs are deliberately never covered by this.
   */
  approvedCode: string[];
  /** Power-user escape hatch: skip the prompt for scripts. Never for packages. */
  autoApprove: boolean;

  setAutoApprove: (value: boolean) => void;
  /** Ask the user. Resolves when they decide, or on timeout. */
  request: (approval: PendingApproval) => Promise<ApprovalDecision>;
  approve: (id: string) => void;
  reject: (id: string) => void;
  /** Reject everything still waiting — used when a chat turn is cancelled. */
  rejectAll: () => void;
}

/** Resolvers for in-flight requests, keyed by id. Deliberately outside the
 *  store: they are callbacks, not state to render. */
const waiting = new Map<
  string,
  {
    resolve: (d: ApprovalDecision) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function settle(id: string, decision: ApprovalDecision) {
  const entry = waiting.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  waiting.delete(id);
  entry.resolve(decision);
}

export const usePendingApprovalsStore = create<PendingApprovalsState>()(
  (set, get) => ({
    pending: [],
    approvedCode: [],
    autoApprove: false,

    setAutoApprove: (value) => set({ autoApprove: value }),

    request: (approval) => {
      const state = get();

      // Installing from PyPI is a supply-chain decision, not a readable script:
      // a typosquatted name looks fine and cannot be judged by reading it. So
      // it always prompts, whatever the script shortcuts say.
      if (approval.kind === "script") {
        if (state.autoApprove || state.approvedCode.includes(approval.code)) {
          log.debug("auto-approved", { id: approval.id });
          return Promise.resolve<ApprovalDecision>("approved");
        }
      }

      set((s) => ({ pending: [...s.pending, approval] }));

      return new Promise<ApprovalDecision>((resolve) => {
        const timer = setTimeout(() => {
          log.info("approval timed out", { id: approval.id });
          set((s) => ({
            pending: s.pending.filter((p) => p.id !== approval.id),
          }));
          settle(approval.id, "timeout");
        }, APPROVAL_TIMEOUT_MS);

        waiting.set(approval.id, { resolve, timer });
      });
    },

    approve: (id) => {
      const approval = get().pending.find((p) => p.id === id);
      set((s) => ({
        pending: s.pending.filter((p) => p.id !== id),
        approvedCode:
          approval?.kind === "script"
            ? [...s.approvedCode, approval.code]
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
