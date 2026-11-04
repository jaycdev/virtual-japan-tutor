// The Practice call to action (plan 4.4 item 3): how many Focus Set items are
// waiting, and one Start button to /practice.
import type { FocusSetView } from "@vjt/core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";

export function PracticeCard({ focus }: { focus: FocusSetView }) {
  const items = focus.items;
  const count = items?.length ?? 0;

  return (
    <Card className="gap-4 px-6" aria-labelledby="practice-heading" data-testid="today-practice-card">
      <h2 id="practice-heading" className="text-title-sm font-semibold text-foreground">
        Practice
      </h2>

      {focus.loading && items === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-5 w-[55%]" />
          <Skeleton className="h-11 w-24" />
        </div>
      ) : focus.error ? (
        <ErrorState message={focus.error} onRetry={focus.retry} />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-muted-foreground">{waitingLine(count)}</p>
          <Button asChild>
            <Link
              to="/practice"
              aria-label="Start practice"
              aria-describedby={count > 0 ? "practice-waiting" : undefined}
            >
              Start
            </Link>
          </Button>
          {count === 0 ? (
            <p className="text-caption text-muted-foreground">
              A session is built from your Focus Set, so there is nothing to practise until a Sync or a Story adds items.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function waitingLine(count: number): string {
  if (count === 0) return "Nothing is waiting in your Focus Set yet.";
  return `${count} Focus Set item${count === 1 ? "" : "s"} waiting.`;
}
