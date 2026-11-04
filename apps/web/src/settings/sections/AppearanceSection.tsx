// Appearance (ui-plan 2.3, 2.4, 4.7): the theme and the Story text size, both
// saved per device. The sample changes at once, through the same CSS variable
// the reader uses.
import { useStoryTextSize } from "../../storysize/index.ts";
import { STORY_TEXT_SIZES } from "../../storysize/store.ts";
import { useThemePreference } from "../../theme/index.ts";
import { ChoiceGroup, Note, SectionBody } from "../parts.tsx";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

export function AppearanceSection() {
  const { preference, setPreference } = useThemePreference();
  const { size, setSize } = useStoryTextSize();

  return (
    <SectionBody>
      <div className="flex flex-col gap-2">
        <ChoiceGroup legend="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
        <Note>Saved on this device. System follows your computer.</Note>
      </div>

      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend="Story text size"
          options={STORY_TEXT_SIZES.map((option) => ({ value: option, label: option }))}
          value={size}
          onChange={setSize}
        />
        <Note>Saved on this device. The size applies to Story text and the Reading Panel.</Note>
        <p
          lang="ja"
          className="mt-2 font-serif text-foreground"
          style={{ fontSize: "var(--story-text-size)", lineHeight: "var(--story-line-height)" }}
        >
          吾輩は猫である。名前はまだ無い。
        </p>
      </div>
    </SectionBody>
  );
}
