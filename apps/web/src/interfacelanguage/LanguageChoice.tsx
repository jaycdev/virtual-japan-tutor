// The Interface Language picker, shared by Appearance and the login card (issue #125).
// The option labels come from @vjt/core untranslated — each language names itself,
// so the buttons read "English / 日本語 / 日本語（ふりがな）" whatever the page says.
// Appearance uses the ChoiceGroup pattern (aria-pressed toggle buttons) with its
// legend and hint; the login card (review V7) uses a compact one-row segmented
// control: same buttons, same aria-pressed state, small and unwrapping.
import { useInterfaceLanguage, useT } from "@vjt/core";

import { T } from "../components/Text.tsx";
import { ChoiceGroup, Note } from "../settings/parts.tsx";

export function InterfaceLanguageChoice({
  withHint = false,
  compact = false,
}: {
  withHint?: boolean;
  compact?: boolean;
}) {
  const { language, setLanguage, options } = useInterfaceLanguage();
  const { tp } = useT();
  // A Japanese option's label is Japanese text shown in every language: marked
  // lang="ja", like the other language names, so it is pronounced right and is
  // not chrome the furigana renderer is expected to annotate (#125 round-2 S5).
  const labelFor = (option: (typeof options)[number]) =>
    option.value === "en" ? option.label : <span lang="ja">{option.label}</span>;
  if (compact) {
    // One row at the card's foot. The legend becomes the group's accessible
    // name, so the row itself stays nothing but the three choices.
    return (
      <div
        role="group"
        aria-label={tp("language.legend")}
        className="flex flex-wrap items-center justify-center gap-1"
      >
        {options.map((option) => {
          const selected = option.value === language;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setLanguage(option.value)}
              className={
                selected
                  ? "min-h-11 rounded-md bg-primary px-2.5 text-small font-medium text-primary-foreground"
                  : "min-h-11 rounded-md border border-input px-2.5 text-small font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              }
            >
              {labelFor(option)}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ChoiceGroup
        legend={<T k="language.legend" />}
        options={options.map((option) => ({ value: option.value, label: labelFor(option) }))}
        value={language}
        onChange={setLanguage}
      />
      {withHint ? (
        <Note>
          <T k="language.hint" />
        </Note>
      ) : null}
    </div>
  );
}
