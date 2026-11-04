import type { StoryToken } from "@vjt/api-client";

/**
 * Furigana decisions for the Story reader (issue #77). The Furigana Threshold
 * itself is the server's call: it sets `showFurigana` on each token (true only
 * for kanji the Learner does not yet know well enough). The client only checks
 * that there is a reading to show, so a kana-only word never gets ruby.
 */

/** Whether this token's reading is rendered above the word. */
export function showsFurigana(token: StoryToken): boolean {
  return token.showFurigana === true && token.reading !== undefined && token.reading !== "";
}

/**
 * The reading size for a story-text size: half the word's font size, the same
 * ratio the `--text-furigana-*` steps keep (9/10.5/12/14 for 18/21/24/28).
 * Mobile reserves its reading slot with this value.
 */
export function furiganaPxFor(fontSizePx: number): number {
  return fontSizePx / 2;
}
