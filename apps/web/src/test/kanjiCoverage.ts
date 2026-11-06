// The furigana coverage check the PR #125 review (B3/S5) asks for: on a screen
// rendered in ja-furigana, interface chrome may show kanji only inside <ruby>.
// Kanji outside ruby is allowed only where it is not chrome:
//   - inside <ruby> (either line: the <T> renderer's base or its <rt>),
//   - inside learning content marked lang="ja" (Story titles, exercise prompts,
//     the Appearance sample line) — but never the root element: the whole
//     document carries <html lang="ja">, so that exemption must not reach it
//     (issue #125 round-2 review S1),
//   - inside aria-hidden brand art (the 読 wordmark),
//   - in screen-reader-only text, which is never drawn and is rendered as plain
//     tp() text precisely so a reader does not say the reading (review V2),
//   - in Intl dates and times ("2026年11月1日"), which have no table reading.
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
// Intl dates and times: 11月5日木曜日, 2026年11月1日, 09:00. Requires a digit,
// so a bare leaked word like 日 never passes as a date.
const DATEISH = /^(?=.*\d)[\d\s:,年月日火水木金土曜時分]+$/;

/** Every visible text node that shows kanji the furigana renderer did not touch. */
export function unrubyfiedKanji(container: HTMLElement): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!KANJI.test(text)) continue;
    const parent = (node as Text).parentElement;
    if (!parent) continue;
    if (parent.closest("ruby")) continue;
    if (parent.closest('[aria-hidden="true"]')) continue;
    if (parent.closest(".sr-only")) continue;
    const root = parent.ownerDocument.documentElement;
    const hit = parent.closest('[lang="ja"]');
    if (hit && hit !== root) continue;
    if (DATEISH.test(text.trim())) continue;
    offenders.push(text.trim());
  }
  return offenders;
}
