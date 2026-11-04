// One-time first-run setup (#50), shown after the very first login on this
// device. Three steps — Starting Level, MaruMori, AI Providers — each one
// embedding the SAME component the Settings hub uses, so the wizard can
// never drift from the settings screen it replaces. Every step is skippable
// (inputs only persist when the Learner presses the section's own Save),
// and the whole flow can be skipped. `firstRun.ts` records that the flow
// was shown, so it never returns.

import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { ApiClient } from "@vjt/api-client";

import { Card } from "./components/ui/Card.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { ProgressBar } from "./state/states.tsx";
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
  const last = step === STEPS.length - 1;

  return (
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
        <Text className="text-title-sm font-semibold text-foreground">{STEPS[step].title}</Text>
        <Text className="text-small text-muted-foreground">{STEPS[step].body}</Text>

        {step === 0 ? <StartingLevelSettings client={client} /> : null}
        {step === 1 ? <MaruMoriSettings client={client} /> : null}
        {step === 2 ? <AiProvidersSettings client={client} /> : null}

        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <LinkButton label="Skip setup" onPress={onFinish} />
          <View className="flex-row items-center gap-3">
            {!last ? (
              <LinkButton label="Skip this step" onPress={() => setStep(step + 1)} />
            ) : null}
            <ActionButton
              filled
              label={last ? "Finish" : "Next"}
              onPress={() => (last ? onFinish() : setStep(step + 1))}
            />
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}
