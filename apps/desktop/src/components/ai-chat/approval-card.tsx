import type { FC } from "react";
import { DownloadIcon, PlayIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingApprovalsStore } from "@/stores/pending-approvals-store";

/**
 * Approval prompt for the tools that act outside the document. The assistant's
 * turn is paused while this is up, so it sits above the composer where it
 * cannot be missed.
 *
 * The script — or the exact package list — is always shown in full. Deciding
 * whether to run code from a summary is not a decision, and a skill that asked
 * for execution may itself have come from someone else.
 */
export const ApprovalCard: FC = () => {
  const pending = usePendingApprovalsStore((s) => s.pending);
  const approve = usePendingApprovalsStore((s) => s.approve);
  const reject = usePendingApprovalsStore((s) => s.reject);

  const approval = pending[0];
  if (!approval) return null;

  const isScript = approval.kind === "script";

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-lg border border-amber-500/50 bg-amber-500/5">
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">
            {isScript
              ? "Run this Python script?"
              : "Install these Python packages?"}
          </div>
          <div className="text-muted-foreground text-xs">
            {isScript ? approval.description : approval.reason}
          </div>
        </div>
        {pending.length > 1 && (
          <span className="shrink-0 text-muted-foreground text-xs">
            1 of {pending.length}
          </span>
        )}
      </div>

      {isScript ? (
        <pre className="mx-3 mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed">
          {approval.code}
        </pre>
      ) : (
        <ul className="mx-3 mt-2 flex flex-wrap gap-1.5 rounded-md bg-muted/60 p-2">
          {approval.packages.map((pkg) => (
            <li
              key={pkg}
              className="rounded-sm bg-background px-1.5 py-0.5 font-mono text-xs"
            >
              {pkg}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <Button size="sm" className="h-7" onClick={() => approve(approval.id)}>
          {isScript ? (
            <>
              <PlayIcon className="size-3.5" /> Run
            </>
          ) : (
            <>
              <DownloadIcon className="size-3.5" /> Install
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => reject(approval.id)}
        >
          <XIcon className="size-3.5" /> Reject
        </Button>
        {/* Say plainly what this does and does not contain. A venv isolates
            dependencies, not access. */}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {isScript
            ? "Runs with your account's file and network access — not sandboxed."
            : "Installs from PyPI into this project. Check the names are the ones you expect."}
        </span>
      </div>
    </div>
  );
};
