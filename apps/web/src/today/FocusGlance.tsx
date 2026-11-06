// The Today Focus Set glance (plan 4.4 item 4): up to eight chips in the focus
// token — never a wall of green — with the full set one click away on Settings.
// Labels come from @vjt/core's useFocusChipLabels, which batches the lookups per
// ApiClient, so a re-render or a "See all" round trip never refetches a word.
import type { ApiClient } from "@vjt/api-client";
import {
  createFocusLabelResolver,
  focusChipKey,
  focusChipLabel,
  useFocusChipLabels,
  useT,
  type FocusSetView,
} from "@vjt/core";
import { useMemo } from "react";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/Text.tsx";

/** At most eight chips on the glance; "See all" carries the rest (plan 4.4). */
const FOCUS_CHIPS_MAX = 8;

export function FocusGlance({ client, focus }: { client: ApiClient; focus: FocusSetView }) {
  const { tp } = useT();
  const items = focus.items ?? [];
  const resolve = useMemo(() => createFocusLabelResolver(client), [client]);
  const labels = useFocusChipLabels(client, items, resolve);

  return (
    <Card className="gap-3 px-6" aria-labelledby="focus-glance-heading" data-testid="today-focus-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="focus-glance-heading" className="text-title-sm font-semibold text-foreground">
          <T k="today.focusSetHeading" />
        </h2>
        {/* A router Link, not an <a>: the app is a SPA and a full page reload
            here would throw away the shell and every loaded state. */}
        <Link to="/settings/focus" className="text-small font-medium text-primary hover:underline">
          <T k="today.seeAll" />
        </Link>
      </div>

      {focus.loading && focus.items === null ? (
        <div className="flex flex-wrap gap-1.5" aria-busy="true">
          {[12, 9, 14, 8].map((w, i) => (
            <Skeleton key={i} className="h-6" style={{ width: `${w * 8}px` }} />
          ))}
        </div>
      ) : focus.error ? (
        // The same failure is already on the Practice card next door with a full
        // Retry; here one quiet line is enough to explain the missing chips.
        <p className="text-small text-muted-foreground">
          <T k="today.focusReadError" />
        </p>
      ) : items.length === 0 ? (
        <p className="text-small text-muted-foreground">
          <T k="today.focusNothingChosen" />
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={tp("today.focusAriaGlance")}>
          {items.slice(0, FOCUS_CHIPS_MAX).map((item) => (
            <li
              key={focusChipKey(item)}
              className="rounded-md border border-focus/40 bg-focus/10 px-2 py-1 text-caption font-medium text-focus"
            >
              {labels[focusChipKey(item)] ?? focusChipLabel(item)}
            </li>
          ))}
          {items.length > FOCUS_CHIPS_MAX ? (
            <li className="rounded-md border border-border bg-muted/40 px-2 py-1 text-caption text-muted-foreground">
              <T k="today.moreCount" params={{ count: items.length - FOCUS_CHIPS_MAX }} />
            </li>
          ) : null}
        </ul>
      )}
    </Card>
  );
}
