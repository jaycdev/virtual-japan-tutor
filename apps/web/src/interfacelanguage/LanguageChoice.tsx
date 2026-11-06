// The Interface Language picker, shared by Appearance and the login card (issue #125).
// The option labels come from @vjt/core untranslated — each language names itself,
// so the buttons read "English / 日本語 / 日本語（ふりがな）" whatever the page says.
// The ChoiceGroup pattern (aria-pressed toggle buttons) matches the other Appearance controls.
import { useInterfaceLanguage } from "@vjt/core";

import { T } from "../components/Text.tsx";
import { ChoiceGroup, Note } from "../settings/parts.tsx";

export function InterfaceLanguageChoice({ withHint = false }: { withHint?: boolean }) {
  const { language, setLanguage, options } = useInterfaceLanguage();
  return (
    <div className="flex flex-col gap-2">
      <ChoiceGroup
        legend={<T k="language.legend" />}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
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
