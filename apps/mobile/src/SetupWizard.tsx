// One-time first-run setup (#50), shown after the very first login on this
// device. Three steps — Starting Level, MaruMori, AI Providers — each one
// embedding the SAME component the Settings hub uses, so the wizard can
// never drift from the settings screen it replaces. Next and Finish save
// what the Learner entered on the step (review S2) through a save the
// section registers with the wizard; "Skip this step" stays a genuine
// no-write skip, and the whole flow is skippable. `firstRun.ts` records
// that the flow was shown, so it never returns.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ScrollView,
  View,
  type ViewInstance,
} from "react-native";
import type { StringKey } from "@vjt/core";
import { useT } from "@vjt/core";

import type { ApiClient } from "@vjt/api-client";

import { useJapaneseFont } from "./japaneseFont/index.tsx";
import { Card } from "./components/ui/Card.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { T } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, ProgressBar } from "./state/states.tsx";
import type { StepSaveFn, StepSaveRegistrar } from "./settingsSections.tsx";
import { AiProvidersSettings } from "./AiProvidersSettings.tsx";
import { MaruMoriSettings } from "./MaruMoriSettings.tsx";
import { StartingLevelSettings } from "./StartingLevelSettings.tsx";

// Titles and blurbs are string-table keys: the wizard's steps are the Settings
// sections themselves, so their names come from the same rows (issue #125).
const STEPS: { titleKey: StringKey; bodyKey: StringKey }[] = [
  { titleKey: "section.levelTitle", bodyKey: "setup.levelBody" },
  { titleKey: "section.marumoriTitle", bodyKey: "setup.marumoriBody" },
  { titleKey: "section.aiTitle", bodyKey: "setup.aiBody" },
];

export function SetupWizard({
  client,
  onFinish,
}: {
  client: ApiClient;
  onFinish: () => void;
}) {
  const jp = useJapaneseFont();
  const { tp } = useT();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [blockedNote, setBlockedNote] = useState<string | undefined>();
  // The step's own save, registered by the embedded section (review S2):
  // Next/Finish run it instead of discarding what the Learner entered. The
  // ref stays the wizard's — the section only calls the registrar, because
  // mutating a ref passed down as a prop breaks the react-hooks rules.
  const stepSave = useRef<StepSaveFn | null>(null);
  const registerSave = useCallback<StepSaveRegistrar>((save) => {
    stepSave.current = save;
  }, []);
  const last = step === STEPS.length - 1;

  // S4: on every step change, hand accessibility focus to the step title, so a
  // screen reader lands on "Step 2 of 3" instead of the page top.
  const titleRef = useRef<ViewInstance | null>(null);
  useEffect(() => {
    const node = titleRef.current;
    if (!node) return;
    try {
      // RN 0.88 hands sendAccessibilityEvent the host instance itself — the ref
      // of the native component — and the Fabric renderer maps it to the real
      // view. (A findNodeHandle number belongs to the deprecated
      // setAccessibilityFocus; the renderer refuses it with a console error.)
      AccessibilityInfo.sendAccessibilityEvent(node as never, "focus");
    } catch {
      // Focus is an enhancement; a host without the hook must not break the step.
    }
  }, [step]);

  // A blocked note belongs to the step that failed; leaving it behind when
  // the Learner skips past that step would accuse the new step of a save it
  // never attempted (seen on device).
  const goToStep = (next: number) => {
    setBlockedNote(undefined);
    setStep(next);
  };

  const advance = async () => {
    setBlockedNote(undefined);
    const save = stepSave.current;
    if (save) {
      setBusy(true);
      try {
        const outcome = await save();
        if (outcome === "blocked") {
          // The section already shows its own error; say why the wizard
          // refused to move, and offer the way out (S2).
          setBlockedNote(tp("setup.blockedNote"));
          return;
        }
      } finally {
        setBusy(false);
      }
    }
    if (last) onFinish();
    else setStep(step + 1);
  };

  return (
    <View className="flex-1">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
        <Card>
          <T
            k="mobile.setupWelcome"
            className={`text-title ${jp.regular} text-foreground`}
            accessibilityRole="header"
          />
          <T k="mobile.setupIntro" className="text-body text-muted-foreground" />
          <View className="w-full">
            <ProgressBar
              value={(step + 1) / STEPS.length}
              label={
                <T
                  k="mobile.setupStepOf"
                  params={{ step: step + 1, total: STEPS.length, title: tp(STEPS[step].titleKey) }}
                  className="text-caption text-muted-foreground"
                />
              }
            />
          </View>
          {/* S4: real heading semantics (header maps to role="heading" on
              the web host), and the node accessibility focus targets. */}
          <View ref={titleRef}>
            <T
              k={STEPS[step].titleKey}
              className="text-title-sm font-semibold text-foreground"
              accessibilityRole="header"
            />
          </View>
          <T k={STEPS[step].bodyKey} className="text-small text-muted-foreground" />

          {step === 0 ? <StartingLevelSettings client={client} registerSave={registerSave} /> : null}
          {step === 1 ? <MaruMoriSettings client={client} registerSave={registerSave} /> : null}
          {step === 2 ? <AiProvidersSettings client={client} registerSave={registerSave} /> : null}

          {blockedNote ? <InlineError message={blockedNote} /> : null}
        </Card>
      </ScrollView>

      {/* P4: the step buttons live OUTSIDE the ScrollView — step 3's long
          form used to push Next/Finish below the fold. */}
      <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2">
        <LinkButton label={<T k="setup.skipAll" className="text-body text-primary" />} onPress={onFinish} disabled={busy} />
        <View className="flex-row items-center gap-3">
          {!last ? (
            <LinkButton
              label={<T k="setup.skipStep" className="text-body text-primary" />}
              onPress={() => goToStep(step + 1)}
              disabled={busy}
            />
          ) : null}
          <ActionButton
            filled
            label={
              <T
                k={last ? "setup.finish" : "setup.next"}
                className="text-body font-semibold text-primary-foreground"
              />
            }
            onPress={() => void advance()}
            disabled={busy}
          />
        </View>
      </View>
    </View>
  );
}
