// Shared loading, empty, error and progress states (ui-plan section 5). Every
// screen composes these, so a state looks the same everywhere: a skeleton shaped
// like the content, one calm line with one action, a destructive message with
// Retry in place of the content that failed, and a bar with a status line for
// work that takes a while. No full-screen spinners, no blocking alerts.
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder bars while content loads. The last line is shorter, like a paragraph. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

/**
 * Nothing to show yet: one line and, at most, one action. Pass the action as an
 * element (a Button, or a Button asChild wrapping a Link) so it keeps its own
 * semantics. `compact` drops the padding for use inside an already-padded card.
 */
export function EmptyState({
  message,
  action,
  compact = false,
}: {
  message: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 text-center", !compact && "p-6")}>
      <p className="text-body text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

/**
 * A failure in place of the content that failed, with one Retry action. Omit
 * `onRetry` when there is nothing to retry (a validation message).
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive p-4"
    >
      <p className="flex-1 text-body text-destructive">{message}</p>
      {onRetry ? (
        <Button variant="destructive" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Long-running work (Story generation, Sync): a bar carrying no text of its own,
 * and one status line under it that says what is happening. `value` is 0 to 1.
 */
export function ProgressStatus({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-caption text-muted-foreground" aria-live="polite">
        {label}
      </p>
    </div>
  );
}
