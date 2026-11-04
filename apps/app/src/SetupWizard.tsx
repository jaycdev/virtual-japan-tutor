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
  Platform,
  ScrollView,
  Text,
  View,
  type ViewInstance,
} from "react-native";

import type { ApiClient } from "@vjt/api-client";

import { Card } from "./components/ui/Card.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, ProgressBar } from "./state/states.tsx";
import type { StepSaveFn, StepSaveRegistrar } from "./settingsSections.tsx";
import { AiProvidersSettings } from "./AiProvidersSettings.tsx";
import { MaruMoriSettings } from "./MaruMoriSettings.tsx";
import { StartingLevelSettings } from "./StartingLevelSettings.tsx";

const STEPS = [
  { title: "Starting Level", body: "We will build your First Story around this." },
  { title: "MaruMori", body: "Add your key to keep your kanji study in sync." },
  { title: "AI Providers", body: "Tell us which model writes your Stories." },
] as const;

export function SetupWizard({
  client,
  onFinish,
}: {
  client: ApiClient;
  onFinish: () => void;
}) {
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

  // S4: on every step change, hand accessibility focus to the step title —
  // DOM focus on the web host, RN's accessibility-focus event on native —
  // so a screen reader lands on "Step 2 of 3" instead of the page top.
  const titleRef = useRef<ViewInstance | null>(null);
  useEffect(() => {
    const node = titleRef.current;
    if (!node) return;
    try {
      if (Platform.OS === "web") {
        const el = node as unknown as HTMLElement;
        if (el instanceof HTMLElement) {
          el.tabIndex = -1; // headings are not focusable until asked to be
          el.focus();
        }
      } else {
        // RN 0.88 hands sendAccessibilityEvent the host instance itself —
        // the ref of the native component — and the Fabric renderer maps it
        // to the real view. (A findNodeHandle number belongs to the
        // deprecated setAccessibilityFocus; the renderer refuses it with a
        // console error, seen on device.)
        AccessibilityInfo.sendAccessibilityEvent(node as never, "focus");
      }
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
          setBlockedNote("The step could not be saved. Fix it and try again, or skip this step.");
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
          <Text className="text-title font-serif text-foreground">Welcome to Virtual Japan Tutor</Text>
          <Text className="text-body text-muted-foreground">
            Three short steps to set you up — you can skip any of them and change
            everything later under Settings.
          </Text>
          <View className="w-full">
            <ProgressBar
              value={(step + 1) / STEPS.length}
              label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step].title}`}
            />
          </View>
          {/* S4: real heading semantics (header maps to role="heading" on
              the web host), and the node accessibility focus targets. */}
          <View ref={titleRef}>
            <Text accessibilityRole="header" className="text-title-sm font-semibold text-foreground">
              {STEPS[step].title}
            </Text>
          </View>
          <Text className="text-small text-muted-foreground">{STEPS[step].body}</Text>

          {step === 0 ? <StartingLevelSettings client={client} registerSave={registerSave} /> : null}
          {step === 1 ? <MaruMoriSettings client={client} registerSave={registerSave} /> : null}
          {step === 2 ? <AiProvidersSettings client={client} registerSave={registerSave} /> : null}

          {blockedNote ? <InlineError message={blockedNote} /> : null}
        </Card>
      </ScrollView>

      {/* P4: the step buttons live OUTSIDE the ScrollView — step 3's long
          form used to push Next/Finish below the fold. */}
      <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2">
        <LinkButton label="Skip setup" onPress={onFinish} disabled={busy} />
        <View className="flex-row items-center gap-3">
          {!last ? (
            <LinkButton label="Skip this step" onPress={() => goToStep(step + 1)} disabled={busy} />
          ) : null}
          <ActionButton
            filled
            label={last ? "Finish" : "Next"}
            onPress={() => void advance()}
            disabled={busy}
          />
        </View>
      </View>
    </View>
  );
}
