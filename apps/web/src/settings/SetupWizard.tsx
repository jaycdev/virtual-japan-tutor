// First-run setup (ui-plan 4.7, 7.2 step 8): three steps, Starting Level, then
// MaruMori, then AI Provider. Each step embeds the SAME section the Settings page
// shows, so the wizard cannot drift from Settings. Next and Finish save what the
// Learner entered on the step through the save the section registers (review S2).
// "Skip this step" is a plain move on, and "Skip setup" leaves the whole flow.
// Afterwards every one of these lives only in Settings.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StepSaveFn, StepSaveRegistrar, StringKey } from "@vjt/core";
import { useT } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { T } from "../components/Text.tsx";
import { ProgressStatus } from "../components/states.tsx";
import { AiProvidersSection } from "./sections/AiProvidersSection.tsx";
import { MaruMoriSection } from "./sections/MaruMoriSection.tsx";
import { StartingLevelSection } from "./sections/StartingLevelSection.tsx";

// The step titles are the Settings section titles (the wizard must match Settings);
// the bodies are the wizard's own, from the string table (issue #125).
const STEPS = [
  { id: "level", titleKey: "section.levelTitle", bodyKey: "setup.levelBody" },
  { id: "marumori", titleKey: "section.marumoriTitle", bodyKey: "setup.marumoriBody" },
  { id: "ai", titleKey: "section.aiTitle", bodyKey: "setup.aiBody" },
] as const satisfies { id: string; titleKey: StringKey; bodyKey: StringKey }[];

export function SetupWizard({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const { tp } = useT();
  // The step's own save, registered by the embedded section. The ref belongs to the wizard;
  // the section only calls the registrar.
  const stepSave = useRef<StepSaveFn | null>(null);
  const registerSave = useCallback<StepSaveRegistrar>((save) => {
    stepSave.current = save;
  }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const last = step === STEPS.length - 1;

  // On every step change, focus moves to the step's title, so a screen reader or the keyboard lands on it.
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  // A blocked note belongs to the step that failed; it must not follow the Learner to the next step.
  const goTo = (next: number) => {
    setBlocked(false);
    setStep(next);
  };

  const advance = async () => {
    setBlocked(false);
    const save = stepSave.current;
    if (save) {
      setBusy(true);
      try {
        const outcome = await save();
        if (outcome === "blocked") {
          // The section already shows its own error; say why the wizard did not move.
          setBlocked(true);
          return;
        }
      } finally {
        setBusy(false);
      }
    }
    if (last) onFinish();
    else setStep(step + 1);
  };

  const current = STEPS[step] ?? STEPS[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-title font-semibold text-foreground">
          <T k="title.setUp" />
        </h1>
        <p className="text-body text-muted-foreground">
          <T k="setup.intro" />
        </p>
      </header>

      <ol aria-label={tp("setup.stepsLabel")} className="flex flex-wrap gap-2">
        {STEPS.map((item, index) => {
          const active = index === step;
          return (
            <li
              key={item.id}
              aria-current={active ? "step" : undefined}
              className={
                active
                  ? "rounded-full bg-primary px-3 py-1 text-small font-semibold text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-small text-muted-foreground"
              }
            >
              {index + 1}. <T k={item.titleKey} />
            </li>
          );
        })}
      </ol>

      <ProgressStatus
        value={(step + 1) / STEPS.length}
        label={`${tp("setup.stepOf", { step: step + 1, total: STEPS.length })}: ${tp(current.titleKey)}`}
      />

      <section aria-labelledby="setup-step-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2
            id="setup-step-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-title-sm font-semibold text-foreground focus:outline-none"
          >
            <T k={current.titleKey} />
          </h2>
          <p className="text-small text-muted-foreground">
            <T k={current.bodyKey} />
          </p>
        </div>

        {step === 0 ? <StartingLevelSection registerSave={registerSave} /> : null}
        {step === 1 ? <MaruMoriSection registerSave={registerSave} /> : null}
        {step === 2 ? <AiProvidersSection registerSave={registerSave} /> : null}

        {blocked ? (
          <p role="alert" className="text-small text-destructive">
            <T k="setup.blockedNote" />
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Back keeps the step state (the Learner's half-typed step is still there)
              and stays inside /setup (issue #81 review). */}
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={() => goTo(step - 1)} disabled={busy}>
              <T k="setup.back" />
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onFinish} disabled={busy}>
            <T k="setup.skipAll" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {last ? null : (
            <Button type="button" variant="outline" onClick={() => goTo(step + 1)} disabled={busy}>
              <T k="setup.skipStep" />
            </Button>
          )}
          <Button type="button" onClick={() => void advance()} disabled={busy}>
            {last ? <T k="setup.finish" /> : <T k="setup.next" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
