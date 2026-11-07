// Item List labels and rules shared by web and mobile (issue #12). Display
// words live in the string table (issue #125); stored names and kinds stay
// English whatever the UI speaks.

import type { ItemList, components } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";

export type ItemKind = components["schemas"]["ItemKind"];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  kanji: translatePlain("en", "item.kanji"),
  vocabulary: translatePlain("en", "item.vocabulary"),
  grammar: translatePlain("en", "item.grammar"),
};

export const ITEM_KINDS = Object.keys(ITEM_KIND_LABELS) as ItemKind[];

/** An Item kind's word in the Learner's Interface Language. */
export function itemKindLabel(kind: ItemKind, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  return translatePlain(lang, kind === "kanji" ? "item.kanji" : kind === "vocabulary" ? "item.vocabulary" : "item.grammar");
}

/** The built-in Saved list: it cannot be renamed or deleted, only configured. */
export function isSavedList(list: Pick<ItemList, "name">): boolean {
  return list.name.toLowerCase() === "saved";
}

/** The master row's hint: default, item count and boosting. */
export function itemListHint(
  list: Pick<ItemList, "isDefault" | "itemCount" | "boosting">,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  const parts: string[] = [];
  if (list.isDefault) parts.push(translatePlain(lang, "itemList.defaultWord"));
  parts.push(translatePlain(lang, list.itemCount === 1 ? "itemList.oneItem" : "itemList.manyItems", { count: list.itemCount }));
  if (list.boosting) parts.push(translatePlain(lang, "itemList.boostingWord"));
  return parts.join(" · ");
}
