// The Interface Language picker, shared by Appearance and the login card
// (issue #125) — the mobile twin of apps/web/src/interfacelanguage/LanguageChoice.tsx.
// The option labels come from @vjt/core untranslated: each language names
// itself, so the buttons read "English / 日本語 / 日本語（ふりがな）" whatever
// the page says — Chips, not <T>, on purpose. RN has no lang attribute, so
// the chip row carries a testID instead: the web twin marks those labels
// lang="ja", and the mobile coverage check exempts the row by the same right.
// Appearance gets the same legend/Card/Chips/Note shape as the theme and font
// pickers; the login card gets a compact one-row switch — same choices,
// 44 dp, unwrapping. Both give the row the legend as its accessible name.

import { useInterfaceLanguage, useT } from "@vjt/core";

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
  const { tp } = useT();

  // One row of self-named chips, shared by both layouts. The legend is the
  // row's accessible name: the web twin wraps the same chips in role="group"
  // with that legend, but "group" is not on this app's device-verified role
  // list (src/accessibilityRoles.test.ts), so the name rides on the plain row
  // — as the reader's lookup row does.
  const chips = (
    <ChipRow testID="language-choice" accessibilityLabel={tp("language.legend")}>
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

  if (compact) {
    // One row at the card's foot: same chips, same group name.
    return chips;
  }

  return (
    <>
      <T k="language.legend" className="text-small font-semibold uppercase text-muted-foreground" />
      <Card>{chips}</Card>
      {withHint ? <T k="language.hint" className="text-small text-muted-foreground" /> : null}
    </>
  );
}
