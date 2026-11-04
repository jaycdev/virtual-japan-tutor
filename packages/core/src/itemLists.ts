// Item List labels and rules shared by web and mobile (issue #12).

import type { ItemList, components } from "@vjt/api-client";

export type ItemKind = components["schemas"]["ItemKind"];

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  kanji: "Kanji",
  vocabulary: "Word",
  grammar: "Grammar",
};

export const ITEM_KINDS = Object.keys(ITEM_KIND_LABELS) as ItemKind[];

/** The built-in Saved list: it cannot be renamed or deleted, only configured. */
export function isSavedList(list: Pick<ItemList, "name">): boolean {
  return list.name.toLowerCase() === "saved";
}

/** The master row's hint: default, item count and boosting. */
export function itemListHint(list: Pick<ItemList, "isDefault" | "itemCount" | "boosting">): string {
  return `${list.isDefault ? "default · " : ""}${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}${list.boosting ? " · boosting" : ""}`;
}
