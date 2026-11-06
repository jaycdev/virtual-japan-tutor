// The Interface Language picker, shared by Appearance and the login card
// (issue #125) — the mobile twin of apps/web/src/interfacelanguage/LanguageChoice.tsx.
// The option labels come from @vjt/core untranslated: each language names
// itself, so the buttons read "English / 日本語 / 日本語（ふりがな）" whatever
// the page says — Chips, not <T>, on purpose. Appearance gets the same
// legend/Card/Chips/Note shape as the theme and font pickers; the login card
// gets a compact one-row switch — same choices, 44 dp, unwrapping.

import { useInterfaceLanguage } from "@vjt/core";

import { T } from "../components/Text.tsx";
import { Card } from "../components/ui/Card.tsx";
import { Chip, ChipRow } from "../components/ui/Chip.tsx";

export function InterfaceLanguageChoice({
  withHint = false,
  compact = false,
}: {
  withHint?: boolean;
  compact?: boolean;
}) {
  const { language, setLanguage, options } = useInterfaceLanguage();

  if (compact) {
    // One row at the card's foot: the chips name themselves, and so does the
    // group around them.
    return (
      <ChipRow>
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={option.value === language}
            onPress={() => setLanguage(option.value)}
          />
        ))}
      </ChipRow>
    );
  }

  return (
    <>
      <T k="language.legend" className="text-small font-semibold uppercase text-muted-foreground" />
      <Card>
        <ChipRow>
          {options.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={option.value === language}
              onPress={() => setLanguage(option.value)}
            />
          ))}
        </ChipRow>
      </Card>
      {withHint ? <T k="language.hint" className="text-small text-muted-foreground" /> : null}
    </>
  );
}
