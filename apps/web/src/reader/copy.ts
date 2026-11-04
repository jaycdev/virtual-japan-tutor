/**
 * The plain Japanese a copy of the Story text gives (issue #77). The column is
 * `<ruby>` markup, so the furigana sit in `<rt>` elements inside the copied
 * range; they are removed here, leaving the words exactly as the Story wrote
 * them. Each sentence ends its own line, so a copied paragraph keeps its breaks.
 * Pure DOM: the copy listener in StoryText hands it the selected range's contents.
 */
export function plainJapanese(fragment: DocumentFragment): string {
  fragment.querySelectorAll("rt, rp").forEach((node) => node.remove());
  fragment.querySelectorAll("p").forEach((p) => p.append("\n"));
  return (fragment.textContent ?? "").replace(/\n+$/, "");
}
