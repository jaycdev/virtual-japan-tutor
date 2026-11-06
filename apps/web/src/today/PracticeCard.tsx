// The Practice call to action (plan 4.4 item 3): how many Focus Set items are
// waiting, and one Start button to /practice.
import { translatePlain, useT, type FocusSetView, type InterfaceLanguage } from "@vjt/core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { T } from "@/components/Text.tsx";

export function PracticeCard({ focus }: { focus: FocusSetView }) {
  const { tp, language } = useT();
  const items = focus.items;
  const count = items?.length ?? 0;

  return (
    <Card className="gap-4 px-6" aria-labelledby="practice-heading" data-testid="today-practice-card">
      <h2 id="practice-heading" className="text-title-sm font-semibold text-foreground">
        <T k="today.practiceHeading" />
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
          <p className="text-body text-muted-foreground" id="practice-waiting">
            {waitingLine(count, language)}
          </p>
          <Button asChild>
            <Link
              to="/practice"
              aria-label={tp("today.practiceStartAria")}
              aria-describedby={count > 0 ? "practice-waiting" : undefined}
            >
              <T k="today.practiceStart" />
            </Link>
          </Button>
          {count === 0 ? (
            <p className="text-caption text-muted-foreground">
              <T k="today.practiceSessionNote" />
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function waitingLine(count: number, language: InterfaceLanguage): string {
  if (count === 0) return translatePlain(language, "today.practiceWaitingNone");
  // English plural -s as a parameter; the Japanese column receives "" (issue #125).
  return translatePlain(language, "today.practiceWaitingCount", {
    count,
    plural: language === "en" && count !== 1 ? "s" : "",
  });
}
