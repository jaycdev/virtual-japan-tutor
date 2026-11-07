/**
 * The Interface Language setting (issue #125): the language the Learner's own
 * UI chrome speaks — labels, hints and failure lines. Stories and exercise
 * content stay in Japanese whatever this says; the setting only changes which
 * language @vjt/core writes its own sentences in.
 *
 * `ja-furigana` is the same Japanese with the furigana the string table
 * carries left visible; `ja` shows the same sentences without it.
 */

export type InterfaceLanguage = "en" | "ja" | "ja-furigana";

/** Until an app wraps its tree in InterfaceLanguageProvider, the UI is English — what every Learner sees today. */
export const DEFAULT_INTERFACE_LANGUAGE: InterfaceLanguage = "en";

export interface InterfaceLanguageOption {
  value: InterfaceLanguage;
  /** Always in its own language: the picker shows "日本語", not "Japanese". */
  label: string;
}

/** The picker order: English first, then plain Japanese, then Japanese with furigana. */
export const interfaceLanguageOptions: readonly InterfaceLanguageOption[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ja-furigana", label: "日本語（ふりがな）" },
];

/** Narrow a stored/queried value to a real Interface Language; anything else is the default. */
export function parseInterfaceLanguage(value: unknown): InterfaceLanguage {
  return value === "ja" || value === "ja-furigana" || value === "en" ? value : DEFAULT_INTERFACE_LANGUAGE;
}

/** Whether a language shows Japanese sentences (with or without furigana). */
export function isJapanese(language: InterfaceLanguage): boolean {
  return language !== "en";
}
