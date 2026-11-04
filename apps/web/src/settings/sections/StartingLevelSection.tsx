// Starting Level (issue #6; ported from apps/mobile StartingLevelSettings): the
// N5–N1 baseline that marks everything at or below it as known, plus the
// read-only list of grammar matches the Learner may want to glance at.
import { useEffect, useState, type FormEvent } from "react";
import {
  STARTING_LEVELS,
  grammarReviewText,
  grammarUpdatedText,
  useGrammarReview,
  useStartingLevel,
  type StartingLevel,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { ChoiceGroup, Note, SaveStatus, SectionBody, Subheading, type SaveState } from "../parts.tsx";

export function StartingLevelSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
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
    setSave({ kind: "saved", message: grammarUpdatedText(res) });
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
    return <ErrorState message={`Cannot load your Starting Level: ${level.state.message}`} onRetry={level.reload} />;
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
          ? `Starting level: ${level.state.level.level}`
          : "Not chosen yet. Pick one to mark everything at or below it as known."}
      </p>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <ChoiceGroup
          legend="Starting Level"
          options={STARTING_LEVELS.map((l) => ({ value: l, label: l }))}
          value={selected}
          onChange={setChoice}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-4">
          {/* Save level is only offered when a pick is pending; the picker alone shows the current level. */}
          <Button type="submit" disabled={busy || choice === null}>
            Save level
          </Button>
          <SaveStatus state={save} />
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <Subheading>Review these grammar matches</Subheading>
        {review.state.status === "loading" ? <SkeletonLines lines={1} /> : null}
        {review.state.status === "error" ? (
          <ErrorState message={`Cannot load the review list: ${review.state.message}`} onRetry={review.reload} />
        ) : null}
        {review.state.status === "ready" && review.state.items.length === 0 ? (
          <p className="text-body text-muted-foreground">Nothing needs a second look.</p>
        ) : null}
        {review.state.status === "ready" && review.state.items.length > 0 ? (
          <>
            <Note>
              These MaruMori grammar points did not match the Catalogue cleanly. They re-check themselves on later Syncs.
            </Note>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {review.state.items.map((item) => (
                <li key={item.marumoriId} className="text-body text-foreground">
                  {grammarReviewText(item)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </SectionBody>
  );
}
