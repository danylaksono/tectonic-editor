import type { FC } from "react";
import { PlayIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingScriptsStore } from "@/stores/pending-scripts-store";

/**
 * Approval prompt for `run_python`. The assistant's turn is paused while this
 * is up, so it sits above the composer where it cannot be missed.
 *
 * The full script is always shown. Deciding whether to run code from a summary
 * is not a decision, and a skill that asked for execution may itself have come
 * from someone else.
 */
export const PendingScriptCard: FC = () => {
  const pending = usePendingScriptsStore((s) => s.pending);
  const approve = usePendingScriptsStore((s) => s.approve);
  const reject = usePendingScriptsStore((s) => s.reject);

  const script = pending[0];
  if (!script) return null;

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-lg border border-amber-500/50 bg-amber-500/5">
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">Run this Python script?</div>
          <div className="text-muted-foreground text-xs">
            {script.description}
          </div>
        </div>
        {pending.length > 1 && (
          <span className="shrink-0 text-muted-foreground text-xs">
            1 of {pending.length}
          </span>
        )}
      </div>

      <pre className="mx-3 mt-2 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed">
        {script.code}
      </pre>

      <div className="flex items-center gap-2 px-3 py-2">
        <Button size="sm" className="h-7" onClick={() => approve(script.id)}>
          <PlayIcon className="size-3.5" /> Run
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => reject(script.id)}
        >
          <XIcon className="size-3.5" /> Reject
        </Button>
        {/* Say plainly what this does and does not contain. A venv isolates
            dependencies, not access. */}
        <span className="ml-auto text-[11px] text-muted-foreground">
          Runs with your account's file and network access — not sandboxed.
        </span>
      </div>
    </div>
  );
};
