import type { StringKey } from "@vjt/core";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { T } from "./components/Text.tsx";
import { useJapaneseFont, type JapaneseFont } from "./japaneseFont/index.tsx";
import { InterfaceLanguageChoice } from "./interfacelanguage/LanguageChoice.tsx";
import { useStoryTextSize, type StoryTextSize } from "./storysize/index.tsx";
import { useTheme, type ThemePreference } from "./theme/index.tsx";

const THEME_CHOICES: { value: ThemePreference; key: StringKey }[] = [
  { value: "light", key: "settings.themeLight" },
  { value: "dark", key: "settings.themeDark" },
  { value: "system", key: "settings.themeSystem" },
];

// The size names are the same letters in every Interface Language — the
// Learner picks S/M/L/XL whatever the chrome around them speaks.
const SIZE_CHOICES: StoryTextSize[] = ["S", "M", "L", "XL"];

const JAPANESE_FONT_CHOICES: { value: JapaneseFont; key: StringKey }[] = [
  { value: "serif", key: "settings.fontSerif" },
  { value: "sans", key: "settings.fontSans" },
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
      <T k="mobile.themeLegend" className="text-small font-semibold uppercase text-muted-foreground" />
      <Card>
        <ChipRow>
          {THEME_CHOICES.map(({ value, key }) => (
            <Chip
              key={value}
              label={<T k={key} className="text-body" />}
              selected={theme.preference === value}
              onPress={() => theme.setPreference(value)}
            />
          ))}
        </ChipRow>
      </Card>
      <T k="mobile.themeNote" className="text-small text-muted-foreground" />

      <T k="settings.storySizeLegend" className="text-small font-semibold uppercase text-muted-foreground" />
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
      <T k="settings.japaneseFontLegend" className="text-small font-semibold uppercase text-muted-foreground" />
      <Card>
        <ChipRow>
          {JAPANESE_FONT_CHOICES.map(({ value, key }) => (
            <Chip
              key={value}
              label={<T k={key} className="text-body" />}
              selected={japanese.font === value}
              onPress={() => japanese.setFont(value)}
            />
          ))}
        </ChipRow>
      </Card>
      <T k="mobile.fontNote" className="text-small text-muted-foreground" />

      <InterfaceLanguageChoice withHint />

      {/* A live sample at the chosen size, so picking a size shows its size:
          the story-* classes are the exact ones the reader renders with.
          Learning content: the sentence is an example of Japanese, never chrome,
          so it stays out of the string table (issue #125). */}
      {/* eslint-disable vjt/no-raw-jsx-text -- Japanese sample sentence, never translated */}
      <Text className={`${SAMPLE_SIZE_CLASS[storyText.size]} ${japanese.regular} text-foreground`}>
        がっこうで べんきょうしました。
      </Text>
      {/* eslint-enable vjt/no-raw-jsx-text */}
    </View>
  );
}
