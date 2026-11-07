// Starting Level (issue #6; ported from apps/mobile StartingLevelSettings): the
// N5–N1 baseline that marks everything at or below it as known, plus the
// read-only list of grammar matches the Learner may want to glance at.
import { useEffect, useState, type FormEvent } from "react";
import {
  grammarReviewText,
  STARTING_LEVELS,
  useGrammarReview,
  useStartingLevel,
  useT,
  type StartingLevel,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { T } from "../../components/Text.tsx";
import { useSession } from "../../session/session.tsx";
import { ChoiceGroup, Note, SaveStatus, SectionBody, Subheading, type SaveState } from "../parts.tsx";

export function StartingLevelSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
  const { language } = useT();
  const { client } = useSession();
  const level = useStartingLevel(client);
  const review = useGrammarReview(client);
  const [choice, setChoice] = useState<StartingLevel | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const stored = level.state.status === "ready" ? level.state.level : null;
  const selected = choice ?? stored?.level ?? "N5";
  const busy = save.kind === "saving";

  // Shared by the Save button and the setup wizard's Next/Finish (review S2).
  // Nothing picked is "nothing": there is no input to write.
  const writeChoice = async (): Promise<StepSaveOutcome> => {
    if (choice === null) return "nothing";
    setSave({ kind: "saving" });
    const res = await level.setLevel(choice);
    if ("status" in res) {
      setSave({ kind: "error", message: res.message });
      return "blocked";
    }
    setChoice(null);
    setSave({ kind: "saved", message: <T k="grammar.updated" params={{ added: res.added ?? 0, removed: res.removed ?? 0 }} /> });
    return "saved";
  };

  // The save is re-registered after every render, so what the Learner last picked is what Next saves.
  useEffect(() => {
    if (!registerSave) return;
    registerSave(writeChoice);
    return () => registerSave(null);
  });

  if (level.state.status === "loading") return <SkeletonLines lines={2} />;
  if (level.state.status === "error") {
    return (
      <ErrorState message={<T k="settings.levelLoadFailed" params={{ message: level.state.message }} />} onRetry={level.reload} />
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (choice === null) return;
    await writeChoice();
  };

  return (
    <SectionBody>
      <p className="text-body text-foreground">
        {level.state.level.configured
          ? <T k="settings.levelCurrent" params={{ level: level.state.level.level ?? "" }} />
          : <T k="settings.levelUnset" />}
      </p>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <ChoiceGroup
          legend={<T k="settings.levelLegend" />}
          options={STARTING_LEVELS.map((l) => ({ value: l, label: l }))}
          value={selected}
          onChange={setChoice}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-4">
          {/* Save level is only offered when a pick is pending; the picker alone shows the current level. */}
          <Button type="submit" disabled={busy || choice === null}>
            <T k="settings.levelSave" />
          </Button>
          <SaveStatus state={save} />
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <Subheading><T k="settings.levelReviewHeading" /></Subheading>
        {review.state.status === "loading" ? <SkeletonLines lines={1} /> : null}
        {review.state.status === "error" ? (
          <ErrorState message={<T k="settings.reviewLoadFailed" params={{ message: review.state.message }} />} onRetry={review.reload} />
        ) : null}
        {review.state.status === "ready" && review.state.items.length === 0 ? (
          <p className="text-body text-muted-foreground"><T k="settings.reviewEmpty" /></p>
        ) : null}
        {review.state.status === "ready" && review.state.items.length > 0 ? (
          <>
            <Note><T k="settings.reviewNote" /></Note>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {review.state.items.map((item) => (
                <li key={item.marumoriId} className="text-body text-foreground">
                  {grammarReviewText(item, language)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </SectionBody>
  );
}
