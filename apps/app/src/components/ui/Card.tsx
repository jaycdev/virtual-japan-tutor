import type { ReactNode } from "react";
import { Platform, View } from "react-native";

/**
 * The card shell shared by the Today sections (issue #47), and the shape
 * Practice's start card is meant to adopt when Practice is rebuilt (a later
 * ticket). `fill` makes the card as tall as its row, for cards that sit side
 * by side in a stretched wide row so their edges line up. It must stay off in
 * the stacked narrow layout, and percentage heights stay off on native
 * entirely: ScrollView content has no definite height there, and a 100% card
 * balloons to the viewport. Native instead grows with the row's own cross-axis
 * stretch (`flex-1` inside a wrapper the row has already stretched).
 */
export function cardFillClass(fill: boolean, os: string): string {
  if (!fill) return "";
  return os === "web" ? "h-full " : "flex-1 ";
}

export function Card({
  children,
  testID,
  fill = false,
  pinned = false,
  padded = true,
}: {
  children: ReactNode;
  testID?: string;
  fill?: boolean;
  /**
   * The pinned (Today's Story) card reads as special: a primary-bordered
   * surface instead of the plain one (issue #48 review, plan §4.5). Token
   * classes only — no one-off colours.
   */
  pinned?: boolean;
  /**
   * `padded={false}` drops the card's own padding and inner gap for content
   * that lays itself out — a list of Rows (#50's hub menu and section
   * cards), where extra padding would push the row separators off the edges
   * and gaps would break them apart.
   */
  padded?: boolean;
}) {
  return (
    <View
      testID={testID}
      className={`${cardFillClass(fill, Platform.OS)}rounded-lg ${
        pinned ? "border-2 border-primary" : "border border-border"
      } bg-card ${padded ? "gap-3 p-5" : ""}`}
    >
      {children}
    </View>
  );
}
