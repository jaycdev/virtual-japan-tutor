// The full Focus Set behind Today's "See all" (ui-plan 4.4 item 4): every item
// the Stories and Practice are built around, with the same chip labels as the
// glance. The set itself is chosen by Syncs, Stories and Practice — this page
// reads it, it does not edit it.
import {
  createFocusLabelResolver,
  focusChipKey,
  focusChipLabel,
  useFocusChipLabels,
  useFocusSet,
  useT,
} from "@vjt/core";
import { useMemo } from "react";

import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Note, SectionBody } from "../parts.tsx";

export function FocusSetSection() {
  const { language, tp } = useT();
  const { client } = useSession();
  const focus = useFocusSet(client);
  const items = focus.items ?? [];
  const resolve = useMemo(() => createFocusLabelResolver(client), [client]);
  const labels = useFocusChipLabels(client, items, resolve);

  if (focus.loading && focus.items === null) return <SkeletonLines lines={3} />;
  if (focus.error)
    return <ErrorState message={tp("settings.focusLoadFailed", { message: focus.error })} onRetry={focus.retry} />;

  return (
    <SectionBody>
      <Note>
        {focus.size === null
          ? tp("settings.focusNote")
          : tp("settings.focusNoteLimit", { size: focus.size })}
      </Note>
      {items.length === 0 ? (
        <p className="text-body text-muted-foreground">{tp("settings.focusEmpty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={tp("settings.focusAria")}>
          {items.map((item) => (
            <li
              key={focusChipKey(item)}
              className="rounded-md border border-focus/40 bg-focus/10 px-2.5 py-1 text-body font-medium text-focus"
            >
              {labels[focusChipKey(item)] ?? focusChipLabel(item, language)}
            </li>
          ))}
        </ul>
      )}
    </SectionBody>
  );
}
