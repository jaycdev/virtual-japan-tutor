// Renders one string-table entry in the Learner's Interface Language (issue #125).
//
// The web half of this file draws `<ruby>`; RN has no ruby, so `ja-furigana`
// reuses the Story reader's token-column layout (src/reader/StoryText.tsx):
// each annotated unit is its own column — a reading slot above its base — in a
// wrapping row, exactly how the reader lays a sentence out. Only the units the
// string table annotates become columns; plain runs split into wrap pieces
// (`wrapPieces` below): kanji and kana break between any two characters, an
// ASCII or digit run — a word, a number, a URL — never does, and fullwidth
// punctuation never strands a bracket at a line edge. `en`/`ja` carry no
// readings at all and render as one plain Text — the sentence as it always
// rendered.
//
// The reading sits at half the base's size (9 px floor, the reader's own
// ratio in `furiganaPxFor`) in the `--furigana` colour, and a button or pill
// that holds an annotated string simply measures the two lines it needs —
// `min-h-11` rows never clip the reading. The column markers `furigana-base`
// and `furigana-reading` are the renderer's own vocabulary: the coverage
// check (src/test/kanjiCoverage.ts) counts a kanji as annotated only inside a
// base cell that holds a reading slot.
//
// Screen readers get the sentence plain: on its own the row is one accessible
// element carrying the sentence with the readings left out; inside a control
// that already names itself (the `Labeled` wrapper below) the row hides from
// assistive tech instead, so the control stays one element with one name.

import { useT, type RubyText, type StringKey, type TranslateParams } from "@vjt/core";
import { createContext, isValidElement, useContext, type ReactNode } from "react";
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

// Where a plain run may break when the row wraps (issue #125 review, S1). The
// reader's own rule for Japanese: any two kana or kanji are a break
// opportunity. An ASCII or digit run is not — a Latin word, a number, a URL
// or a server's {message} crosses a line the way the browser would break it,
// not one character at a time. And the breaks must not strand fullwidth
// marks: 。、」… never start a piece, 「（ never end one.
const WIDE_RANGES: [number, number][] = [
  [0x2e80, 0x2eff], // CJK radicals
  [0x3000, 0x30ff], // CJK punctuation, kana, the prolonged-sound ー
  [0x31f0, 0x31ff], // katakana extensions
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe4f], // vertical and CJK compatibility forms
  [0xff00, 0xff60], // fullwidth forms
  [0xff65, 0xffdc], // halfwidth katakana
  [0xffe0, 0xffe6], // fullwidth signs
];
/** Fullwidth marks glued to the piece before them: they never start a line. */
const CLOSE_MARKS = "。、，．・：；！？）］》〉」』】〉々〆ー…｡､｣";
/** Brackets glued to the piece after them: they never end a line. */
const OPEN_MARKS = "（(「『《〈［";

function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * The wrap pieces of a plain run: one per kanji or kana (with any closing
 * mark glued on), each ASCII/digit word, number or URL in one whole piece,
 * opening brackets carried onto the piece after them. Exported for its test.
 */
export function wrapPieces(text: string): string[] {
  const pieces: string[] = [];
  let open = ""; // opening brackets waiting on the next piece
  let word = ""; // the ASCII/digit run being read, spaces kept inside it
  const flush = () => {
    if (!word) return;
    pieces.push(open + word);
    open = "";
    word = "";
  };
  for (const ch of text) {
    if (OPEN_MARKS.includes(ch)) {
      flush();
      open += ch;
    } else if (CLOSE_MARKS.includes(ch)) {
      if (word) word += ch;
      else if (open) open += ch;
      else if (pieces.length > 0) pieces[pieces.length - 1] += ch;
      else pieces.push(ch);
    } else if (isWide(ch)) {
      flush();
      pieces.push(open + ch);
      open = "";
    } else if (ch === " ") {
      if (word) flush();
      if (pieces.length > 0) pieces[pieces.length - 1] += ch; // the space rides with the piece before it
      else if (open) open += ch;
      else pieces.push(ch);
    } else {
      word += ch;
    }
  }
  flush();
  if (open) pieces.push(open);
  return pieces;
}

/**
 * True where a control around this text already announces it — set by the
 * `Labeled` wrapper below. A furigana row inside then stays out of the
 * accessibility tree rather than standing as a second element naming the
 * same sentence.
 */
const LabeledContext = createContext(false);

/**
 * Wrap the drawn label of a control whose `accessibilityLabel` says the same
 * thing (Chip, Row, the tab buttons…): the `<T>` inside hides itself from
 * assistive tech instead of exposing the sentence a second time.
 */
export function Labeled({ children }: { children: ReactNode }) {
  return <LabeledContext.Provider value={true}>{children}</LabeledContext.Provider>;
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
  numberOfLines,
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
  /** Where the plain Text before this truncated, keep it to that many lines. */
  numberOfLines?: number;
}) {
  const labeled = useContext(LabeledContext);
  if (!segments.some((segment) => segment.ruby)) {
    // Nothing annotated (en, ja, kanji-free entries): the plain sentence.
    return (
      <Text
        className={className}
        accessibilityRole={accessibilityRole}
        accessibilityLiveRegion={accessibilityLiveRegion}
        numberOfLines={numberOfLines}
        style={style}
        testID={testID}
      >
        {segments.map((segment) => segment.text).join("")}
      </Text>
    );
  }
  const readingPx = chromeFuriganaPx(basePxFor(className));
  // On its own the row is one accessible element labelled with the plain
  // sentence; inside a labelled control it takes no name at all — the
  // control's own label already says it, and a second element repeating the
  // sentence is exactly what a Listener hears twice. (aria-hidden on the web
  // host, elements-hidden on iOS, no-hide-descendants on Android.)
  const announce = labeled
    ? {
        "aria-hidden": true,
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants" as const,
      }
    : {
        accessibilityRole: accessibilityRole ?? "text",
        accessible: true,
        accessibilityLabel: segments.map((segment) => segment.text).join(""),
      };
  return (
    <View
      accessibilityLiveRegion={accessibilityLiveRegion}
      testID={testID}
      className="flex-row flex-wrap items-end"
      {...announce}
    >
      {segments.map((segment, i) =>
        segment.ruby ? (
          // The token column: reading slot over base, hidden from assistive
          // tech whole so the label above is the only thing read out. The
          // markers tell the coverage check this base really holds a reading.
          <View
            key={i}
            testID="furigana-base"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center"
          >
            <Text
              testID="furigana-reading"
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
          // A plain run wraps like the reader's kana: one piece per break
          // opportunity (see wrapPieces), so the row breaks wherever the
          // sentence needs it while a Latin word or URL stays whole and a
          // reading column above its base never splits.
          wrapPieces(segment.text).map((piece, j) => (
            <Text key={`${i}-${j}`} className={className} numberOfLines={numberOfLines} style={style}>
              {piece}
            </Text>
          ))
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
