// Appearance (ui-plan 2.3, 2.4, 4.7): the theme, the Story text size, the
// Japanese font and the Interface Language, all saved per device. The sample
// changes at once, through the same CSS variables the reader uses.
import type { ReactNode } from "react";

import { T } from "../../components/Text.tsx";
import { InterfaceLanguageChoice } from "../../interfacelanguage/LanguageChoice.tsx";
import { useJapaneseFont } from "../../japaneseFont/index.ts";
import type { JapaneseFont } from "../../japaneseFont/store.ts";
import { useStoryTextSize } from "../../storysize/index.ts";
import { STORY_TEXT_SIZES } from "../../storysize/store.ts";
import { useThemePreference } from "../../theme/index.ts";
import { ChoiceGroup, Note, SectionBody } from "../parts.tsx";

export function AppearanceSection() {
  const { preference, setPreference } = useThemePreference();
  const { size, setSize } = useStoryTextSize();
  const { font, setFont } = useJapaneseFont();

  const themeOptions = [
    { value: "light", label: <T k="settings.themeLight" /> },
    { value: "dark", label: <T k="settings.themeDark" /> },
    { value: "system", label: <T k="settings.themeSystem" /> },
  ] as const;

  const fontOptions = [
    { value: "serif", label: <T k="settings.fontSerif" /> },
    { value: "sans", label: <T k="settings.fontSans" /> },
  ] as const satisfies { value: JapaneseFont; label: ReactNode }[];

  return (
    <SectionBody>
      <div className="flex flex-col gap-2">
        <ChoiceGroup legend={<T k="settings.themeLegend" />} options={themeOptions} value={preference} onChange={setPreference} />
        <Note><T k="settings.savedTheme" /></Note>
      </div>

      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend={<T k="settings.japaneseFontLegend" />}
          options={fontOptions}
          value={font}
          onChange={(value: JapaneseFont) => setFont(value)}
        />
        <Note><T k="settings.savedFont" /></Note>
      </div>

      <div className="flex flex-col gap-2">
        <ChoiceGroup
          legend={<T k="settings.storySizeLegend" />}
          options={STORY_TEXT_SIZES.map((option) => ({ value: option, label: option }))}
          value={size}
          onChange={setSize}
        />
        <Note><T k="settings.savedSize" /></Note>
        <p
          lang="ja"
          className="mt-2 font-serif text-foreground"
          style={{ fontSize: "var(--story-text-size)", lineHeight: "var(--story-line-height)" }}
        >
          {/* eslint-disable-next-line vjt/no-raw-jsx-text -- Japanese sample sentence for the size preview, not chrome text (issue #125) */}
          吾輩は猫である。名前はまだ無い。
        </p>
      </div>

      <InterfaceLanguageChoice withHint />
    </SectionBody>
  );
}
