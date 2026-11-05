import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { useJapaneseFont, type JapaneseFont } from "./japaneseFont/index.tsx";
import { useStoryTextSize, type StoryTextSize } from "./storysize/index.tsx";
import { useTheme, type ThemePreference } from "./theme/index.tsx";

const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const SIZE_CHOICES: StoryTextSize[] = ["S", "M", "L", "XL"];

const JAPANESE_FONT_CHOICES: { value: JapaneseFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
];

/**
 * The live sample is rendered at the chosen size with the very classes the
 * reader uses. Each variant is spelled out so the Uniwind scanner sees it.
 */
const SAMPLE_SIZE_CLASS: Record<StoryTextSize, string> = {
  S: "text-story-s",
  M: "text-story-m",
  L: "text-story-l",
  XL: "text-story-xl",
};

/**
 * Appearance on the #50 hub: the colour theme (Light / Dark / System) and
 * the Story text size (S–XL). Both are per-device — theme is ADR-0008, the
 * size rides the same storage split — and both are already consumed by the
 * chrome and the Story reader, so this screen is the one place the Learner
 * can see and change them.
 */
export function AppearanceSettings() {
  const theme = useTheme();
  const storyText = useStoryTextSize();
  const japanese = useJapaneseFont();

  return (
    <View className="gap-4">
      <Text className="text-small font-semibold uppercase text-muted-foreground">Colour theme</Text>
      <Card>
        <ChipRow>
          {THEME_CHOICES.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              selected={theme.preference === value}
              onPress={() => theme.setPreference(value)}
            />
          ))}
        </ChipRow>
      </Card>
      <Text className="text-small text-muted-foreground">
        System follows the device. The choice is saved on this device only.
      </Text>

      <Text className="text-small font-semibold uppercase text-muted-foreground">
        Story text size
      </Text>
      <Card>
        <ChipRow>
          {SIZE_CHOICES.map((size) => (
            <Chip
              key={size}
              label={size}
              selected={storyText.size === size}
              onPress={() => storyText.setSize(size)}
            />
          ))}
        </ChipRow>
      </Card>
      <Text className="text-small font-semibold uppercase text-muted-foreground">Japanese font</Text>
      <Card>
        <ChipRow>
          {JAPANESE_FONT_CHOICES.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              selected={japanese.font === value}
              onPress={() => japanese.setFont(value)}
            />
          ))}
        </ChipRow>
      </Card>
      <Text className="text-small text-muted-foreground">
        Sans is plainer, with simpler strokes. Saved on this device only.
      </Text>

      {/* A live sample at the chosen size, so picking a size shows its size:
          the story-* classes are the exact ones the reader renders with. */}
      <Text className={`${SAMPLE_SIZE_CLASS[storyText.size]} ${japanese.serif} text-foreground`}>
        がっこうで べんきょうしました。
      </Text>
    </View>
  );
}
