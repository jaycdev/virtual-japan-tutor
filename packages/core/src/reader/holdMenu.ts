import type { StoryGrammarSpan, StorySentence, StoryToken, WeakSignalRequest } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "../i18n/language.ts";
import { translatePlain } from "../i18n/translate.ts";

/**
 * The Lookup Menu gesture (issue #14), as pure state so the hold/slide/release
 * rules are testable without a screen. On Android the finger does it all:
 *
 *   press   finger down on a token — the Lookup row shows the word and the
 *           hold timer starts (lookupHoldMs from the Reading Settings);
 *   hold    the timer elapsing opens the Lookup Menu anchored under the
 *           finger and reports the hold as a Weak Signal;
 *   slide   moving with the finger down tracks the finger for the release;
 *   release lifting over a menu option runs it; anywhere else cancels.
 *
 * A press released before the threshold is a tap: the sentence stays selected
 * and the Lookup row keeps the word, but no menu opens and nothing is signaled.
 */

/** Which token a gesture, menu, or window is about. */
export interface TokenRef {
  sentence: number;
  index: number;
}

export type MenuOptionId = "dictionary" | "grammar" | "save" | "saveTo";

/** Fixed option order — also the tie-break order for hit-testing. */
export const MENU_OPTION_ORDER: MenuOptionId[] = ["dictionary", "grammar", "save", "saveTo"];

export interface HoldState {
  phase: "idle" | "press" | "menu";
  /** The token the gesture started on; null while idle. */
  token: TokenRef | null;
  /** Finger position when the press began — where the menu is anchored. */
  anchorX: number;
  anchorY: number;
}

export const IDLE: HoldState = { phase: "idle", token: null, anchorX: 0, anchorY: 0 };

export type HoldEvent =
  | { type: "press"; token: TokenRef; x: number; y: number }
  | { type: "holdElapsed" }
  | { type: "cancel" };

/**
 * One reducer for the whole gesture, dispatching exactly what the reader
 * sends it. `holdElapsed` is emitted by a timer the caller owns; a press
 * released before it stays in `press` and the caller just dispatches `cancel`.
 * `holdElapsed` only fires from `press`, and `cancel` always returns to idle,
 * so a stale timer or a stolen gesture (a scroll that terminates the
 * responder) cannot open a menu behind the Learner's back. Sliding through
 * the menu moves only the finger: the release point decides, so no move
 * events are needed and the menu stays anchored at the press.
 */
export function reduceHold(state: HoldState, event: HoldEvent): HoldState {
  switch (event.type) {
    case "press":
      return {
        phase: "press",
        token: event.token,
        anchorX: event.x,
        anchorY: event.y,
      };
    case "holdElapsed":
      if (state.phase !== "press") return state;
      return { ...state, phase: "menu" };
    case "cancel":
      return IDLE;
  }
}

/** A rectangle in window coordinates, as reported by measureInWindow. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The slice of a rendered node the menu measures. RN hands refs as opaque
 * ReactNativeElement instances carrying measureInWindow; naming just that
 * method keeps the measuring function — and the injected test fake — honest.
 */
export interface MeasurableNode {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/**
 * Which menu option (if any) the release point sits over. Inert options never
 * take the release — lifting over a disabled Dictionary simply cancels, the
 * same as lifting outside the menu.
 */
export function optionAt(
  rects: Partial<Record<MenuOptionId, Rect>>,
  options: { id: MenuOptionId; enabled: boolean }[],
  x: number,
  y: number,
): MenuOptionId | null {
  for (const id of MENU_OPTION_ORDER) {
    const option = options.find((o) => o.id === id);
    if (!option || !option.enabled) continue;
    const r = rects[id];
    if (!r) continue;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return id;
  }
  return null;
}

/** One visible Lookup Menu row, with its enabled and label rules. */
export interface MenuOption {
  id: MenuOptionId;
  label: string;
  enabled: boolean;
  /** Why an option is dimmed or what it points at. */
  hint?: string;
}

/**
 * The menu contents for a token: Dictionary needs a dictionary entry; Grammar
 * appears only for a token a Grammar Span covers, keeping words inside spans
 * reachable; Save and Save to… need something saveable (the entry, or the
 * Span's Grammar Point when the token has no entry of its own) and loaded
 * Item Lists.
 */
export function menuOptions(
  token: StoryToken,
  span: StoryGrammarSpan | null,
  listsReady: boolean,
  defaultListName?: string,
  /** The last lookup for this word failed (issue #14 review): Dictionary dims. */
  dictionaryFailed = false,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): MenuOption[] {
  const linked = token.entSeq !== undefined;
  const saveable = linked || span !== null;
  const unlinked = translatePlain(lang, "reader.menu.unlinked");
  const failed = translatePlain(lang, "reader.menu.lookupFailed");
  const loading = translatePlain(lang, "reader.menu.listsLoading");
  const target = defaultListName
    ? translatePlain(lang, "reader.menu.saveToTarget", { list: defaultListName })
    : translatePlain(lang, "reader.menu.saveToDefault");
  const options: MenuOption[] = [
    {
      id: "dictionary",
      label: translatePlain(lang, "reader.menu.dictionary"),
      enabled: linked && !dictionaryFailed,
      hint: !linked ? unlinked : dictionaryFailed ? failed : undefined,
    },
  ];
  if (span)
    options.push({
      id: "grammar",
      label: translatePlain(lang, "reader.menu.grammar"),
      enabled: true,
      hint: `${span.pattern}: ${span.meaning}`,
    });
  options.push(
    {
      id: "save",
      label: translatePlain(lang, "reader.menu.save"),
      enabled: saveable && listsReady,
      hint: !saveable ? unlinked : !listsReady ? loading : target,
    },
    {
      id: "saveTo",
      label: translatePlain(lang, "reader.menu.saveTo"),
      enabled: saveable && listsReady,
      hint: !saveable ? unlinked : !listsReady ? loading : translatePlain(lang, "reader.menu.saveToOther"),
    },
  );
  return options;
}

/** The item Save targets for a token: its entry, else the Span's Grammar Point. */
export function saveableItem(
  token: StoryToken,
  span: StoryGrammarSpan | null,
): { kind: "vocabulary" | "grammar"; ref: string } | null {
  if (token.entSeq !== undefined) return { kind: "vocabulary", ref: String(token.entSeq) };
  if (span) return { kind: "grammar", ref: span.grammarPointId };
  return null;
}

/**
 * The Weak Signal one hold reports. A word inside a Grammar Span signals the
 * Grammar Point; otherwise a word with a dictionary entry signals the entry;
 * an unlinked word signals nothing. One signal per hold, sent at hold-trigger
 * — the mobile hold *is* the Lookup Menu opening, so unlike the web there is
 * no second `menu_open` signal and no Known-only gating on the client: the
 * server keeps only signals about the Learner's Known Items and drops the
 * rest, so sending every hold is honest and cheaper than guessing.
 */
export function holdSignal(token: StoryToken, span: StoryGrammarSpan | null): WeakSignalRequest | null {
  if (span) return { itemKind: "grammar", itemRef: span.grammarPointId, reason: "lookup" };
  if (token.entSeq !== undefined) return { itemKind: "vocabulary", itemRef: String(token.entSeq), reason: "lookup" };
  return null;
}

/** The Grammar Span covering this token, if any (codepoint offsets). */
export function coveringSpan(sentence: StorySentence, token: StoryToken): StoryGrammarSpan | null {
  for (const sp of sentence.grammarSpans) {
    if (token.start < sp.end && sp.start < token.end) return sp;
  }
  return null;
}

/** The grammar point a Lookup describes: its Grammar Span, else a particle's hint (issue #98). */
export type GrammarCue = Pick<StoryGrammarSpan, "pattern" | "meaning" | "jlptLevel" | "srsLevel">;

export function grammarCue(token: StoryToken, span: StoryGrammarSpan | null): GrammarCue | null {
  if (span) return span;
  if (token.grammarHint) return token.grammarHint;
  return null;
}

/**
 * Whether a word is a particle with only its catalogue hint behind it: no
 * dictionary entry and no Grammar Span. It shows its Lookup row on hover or
 * press, but opens no Lookup Menu and reports no Weak Signal, since there is
 * nothing to look up in a dictionary or save.
 */
export function hintOnly(token: StoryToken, span: StoryGrammarSpan | null): boolean {
  return token.entSeq === undefined && span === null && token.grammarHint !== undefined;
}

/**
 * The Reading Panel's one shrink step: the sentence box starts at full size;
 * when the text overflows it drops to the shrunk size exactly once and then
 * scrolls internally. A box measured at zero height (jsdom, or a layout that
 * has not settled) never shrinks.
 */
export function shouldShrink(contentHeight: number, boxHeight: number): boolean {
  return boxHeight > 0 && contentHeight > boxHeight;
}
