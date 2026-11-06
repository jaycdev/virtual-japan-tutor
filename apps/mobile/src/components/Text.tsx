// Renders one string-table entry in the Learner's Interface Language (issue #125).
//
// The web half of this file draws `<ruby>`; RN has no ruby, so `ja-furigana`
// reuses the Story reader's token-column layout (src/reader/StoryText.tsx):
// each annotated unit is its own column — a reading slot above its base — in a
// wrapping row, exactly how the reader lays a sentence out. Only the units the
// string table annotates become columns; the rest of the sentence stays plain
// text, and `en`/`ja` carry no readings at all and render as one plain Text —
// the sentence as it always rendered.
//
// The reading sits at half the base's size (9 px floor, the reader's own
// ratio in `furiganaPxFor`) in the `--furigana` colour, and a button or pill
// that holds an annotated string simply measures the two lines it needs —
// `min-h-11` rows never clip the reading.
//
// Screen readers get the sentence plain: the drawn columns are hidden whole
// (the reader's own no-hide-descendants trick) and the container carries one
// clean label — the Japanese without any readings.

import { useT, type RubyText, type StringKey, type TranslateParams } from "@vjt/core";
import { isValidElement, type ReactNode } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";

/** The interface type scale (packages/design tokens.ts), keyed by its class name. */
const BASE_PX: Record<string, number> = {
  "text-caption": 12,
  "text-small": 14,
  "text-body": 16,
  "text-title-sm": 18,
  "text-title": 22,
  "text-display": 28,
};

/** The reading size for a line: half the base, never under the reader's 9 px floor. */
export function chromeFuriganaPx(basePx: number): number {
  return Math.max(9, basePx / 2);
}

/** Which type scale a class string names; a line without one is body text. */
function basePxFor(className: string | undefined): number {
  if (!className) return BASE_PX["text-body"];
  for (const name of ["text-title-sm", "text-caption", "text-small", "text-title", "text-display", "text-body"]) {
    if (className.includes(name)) return BASE_PX[name];
  }
  return BASE_PX["text-body"];
}

/**
 * The segments of one table entry, drawn in the current Interface Language.
 * `className` is the line's text styling (size + colour classes): it rides on
 * every piece of base text — a native Text takes no colour from a View around
 * it, so each word carries its own, exactly as the reader's tokens do.
 */
export function TableText({
  segments,
  className,
  accessibilityRole,
  accessibilityLiveRegion,
  style,
  testID,
}: {
  segments: RubyText;
  className?: string;
  /** Set this where the line is a heading, so the header role survives. */
  accessibilityRole?: "header" | "text" | "alert";
  /** Line styling a className cannot carry: weights, letter spacing, padding. */
  style?: StyleProp<TextStyle>;
  /** Rides on the line's outer element, annotated or not. */
  testID?: string;
  /** For status lines: the polite/assertive live region the plain Text had. */
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
}) {
  if (!segments.some((segment) => segment.ruby)) {
    // Nothing annotated (en, ja, kanji-free entries): the plain sentence.
    return (
      <Text
        className={className}
        accessibilityRole={accessibilityRole}
        accessibilityLiveRegion={accessibilityLiveRegion}
        style={style}
        testID={testID}
      >
        {segments.map((segment) => segment.text).join("")}
      </Text>
    );
  }
  const readingPx = chromeFuriganaPx(basePxFor(className));
  // One wrapped row of columns and plain runs, the reader's paragraph; the
  // container is one accessible element naming the sentence plain.
  return (
    <View
      accessibilityRole={accessibilityRole ?? "text"}
      accessibilityLiveRegion={accessibilityLiveRegion}
      accessible
      accessibilityLabel={segments.map((segment) => segment.text).join("")}
      testID={testID}
      className="flex-row flex-wrap items-end"
    >
      {segments.map((segment, i) =>
        segment.ruby ? (
          // The token column: reading slot over base, hidden from assistive
          // tech whole so the label above is the only thing read out.
          <View
            key={i}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center"
          >
            <Text
              className="text-furigana text-center leading-none"
              style={{ fontSize: readingPx, lineHeight: readingPx }}
            >
              {segment.ruby}
            </Text>
            <Text className={className} style={style}>
              {segment.text}
            </Text>
          </View>
        ) : (
          <Text key={i} className={className} style={style}>
            {segment.text}
          </Text>
        ),
      )}
    </View>
  );
}

/**
 * One entry as a plain string in the current Interface Language — for text
 * that is never *drawn* (accessibilityLabel, accessibilityHint, placeholder,
 * dialog titles): in `ja-furigana` these read plain Japanese, readings left
 * out, exactly what a screen reader should say. A hook: call it at the top of
 * a component (`const tp = useTp()`), then use `tp(k, params)` anywhere below.
 */
export function useTp(): (k: StringKey, params?: TranslateParams) => string {
  return useT().tp;
}

/**
 * The plain string a *label* names, for the a11y props a control needs: a
 * string label is its own name, and a `<T>` element is recognised by type so
 * a control (Field, Row, SwitchRow, Chip) can name itself after the entry the
 * label draws — in `ja-furigana` the plain Japanese, readings left out.
 * `tp` comes from `useT()`; a label built any other way adds no name.
 */
export function labelAria(
  label: ReactNode,
  tp: (k: StringKey, params?: TranslateParams) => string,
): string | undefined {
  if (typeof label === "string") return label;
  if (isValidElement<{ k?: StringKey; params?: TranslateParams }>(label) && label.type === T) {
    return label.props.k === undefined ? undefined : tp(label.props.k, label.props.params);
  }
  return undefined;
}

/**
 * One entry of the string table, in the Interface Language of the surrounding
 * provider. It stands on its own — put `className` here rather than wrapping
 * it in a <Text>, because a furigana line is a row of columns, not a string.
 */
export function T({
  k,
  params,
  className,
  accessibilityRole,
  accessibilityLiveRegion,
  style,
  testID,
}: {
  k: StringKey;
  params?: TranslateParams;
  className?: string;
  accessibilityRole?: "header" | "text" | "alert";
  style?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
}) {
  const { t } = useT();
  return (
    <TableText
      segments={t(k, params)}
      className={className}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={style}
      testID={testID}
    />
  );
}
