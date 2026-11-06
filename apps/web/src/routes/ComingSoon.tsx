import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { T } from "../components/Text.tsx";

/** A destination whose screen lands in a later issue (ui-plan 7.2). Uses the shared EmptyState: one line, one action. */
export function ComingSoon({ title, issue }: { title: string; issue: number }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title font-semibold text-foreground">{title}</h1>
      <EmptyState
        message={<T k="comingSoon.soon" params={{ issue }} />}
        action={
          <Button asChild variant="outline">
            <Link to="/"><T k="comingSoon.backToToday" /></Link>
          </Button>
        }
      />
    </section>
  );
}
