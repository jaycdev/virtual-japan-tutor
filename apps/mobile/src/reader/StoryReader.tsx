import type { ApiClient, Story, WeakSignalRequest } from "@vjt/api-client";
import { type StoryView, useItemLists, useReadingSettings } from "@vjt/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type NativeTouchEvent } from "react-native";

import { useHardwareBack } from "../hardwareBack.ts";
import { MIN_TOUCH, useColors } from "../theme.ts";
import { RatingButtons } from "./parts.tsx";
import { ReadingPanel, type LookedTarget } from "./ReadingPanel.tsx";
import { StoryParagraph, type TokenHandlers } from "./StoryText.tsx";
import { SaveToSheet } from "./SaveToSheet.tsx";
import { TokenMenu } from "./TokenMenu.tsx";
import { DictionaryWindow, GrammarWindow } from "./Windows.tsx";
import { useEntryLookup } from "./useEntryLookup.ts";
import {
  coveringSpan,
  holdSignal,
  menuOptions,
  optionAt,
  saveableItem,
  type MeasurableNode,
  type MenuOption,
  type MenuOptionId,
  type Rect,
  type TokenRef,
} from "./holdMenu.ts";

/**
 * The mobile Story reader (issue #14): the story text scrolls under a fixed
 * Reading Panel; pressing a token selects its sentence, primes its Lookup
 * row, and starts the hold timer. Holding past lookupHoldMs opens the Lookup
 * Menu at the finger — that hold is the Weak Signal — and lifting the finger
 * over a menu option runs it (Dictionary / Grammar open centred windows,
 * Save writes to the Default List, Save to… opens the bottom sheet);
 * anywhere else the release cancels. Android Back unwinds one layer at a
 * time: sheet, then window, then menu, then back to the library.
 */

interface OpenMenu {
  ref: TokenRef;
  x: number;
  y: number;
  options: MenuOption[];
}

const sameRef = (a: TokenRef, b: TokenRef) => a.sentence === b.sentence && a.index === b.index;

export function StoryReader({
  client,
  view,
  story,
  onBack,
}: {
  client: ApiClient;
  view: StoryView;
  story: Story;
  onBack: () => void;
}) {
  const colors = useColors();
  const reading = useReadingSettings(client);
  const lists = useItemLists(client);
  const lookup = useEntryLookup(client);

  const [selected, setSelected] = useState<number | null>(null);
  const [looked, setLooked] = useState<LookedTarget | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [menuRects, setMenuRects] = useState<Map<string, Rect> | null>(null);
  const [windows, setWindows] = useState<LookedTarget[]>([]);
  const [sheetToken, setSheetToken] = useState<TokenRef | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [screen, setScreen] = useState({ width: 0, height: 0 });

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => cancelHold, []);

  // Weak Signals: each (item, reason) once per open story; the server keeps
  // only the Learner's Known Items and drops the rest, so this is
  // fire-and-forget and never blocks the reader.
  const signaled = useRef<Set<string>>(new Set());
  const reportSignals = (signals: WeakSignalRequest[]) => {
    const fresh = signals.filter((s) => {
      const key = `${s.itemKind}|${s.itemRef}|${s.reason}`;
      if (signaled.current.has(key)) return false;
      signaled.current.add(key);
      return true;
    });
    if (fresh.length > 0) void lists.reportWeakSignals(fresh);
  };

  // Unblurring a Sentence Translation signals the sentence's Focus Set
  // items — the Learner reached for the answer (issue #12).
  const onUnblur = (sentenceIdx: number) => {
    const sen = story.sentences[sentenceIdx];
    if (!sen) return;
    const inSentence = new Set(sen.tokens.flatMap((t) => (t.entSeq === undefined ? [] : [t.entSeq])));
    const signals: WeakSignalRequest[] = [];
    for (const v of story.vocabItems ?? []) {
      if (v.isFocus && v.entSeq !== undefined && inSentence.has(v.entSeq)) {
        signals.push({ itemKind: "vocabulary", itemRef: String(v.entSeq), reason: "translation_unblur" });
      }
    }
    for (const sp of sen.grammarSpans) {
      if (sp.isFocus) signals.push({ itemKind: "grammar", itemRef: sp.grammarPointId, reason: "translation_unblur" });
    }
    reportSignals(signals);
  };

  const closeMenu = () => {
    setMenu(null);
    setMenuRects(null);
  };

  /** Finger down on a token: select, prime the Lookup row, start the hold. */
  const onTokenGrant = (ref: TokenRef, e: NativeSyntheticEvent<NativeTouchEvent>) => {
    cancelHold();
    closeMenu();
    const sen = story.sentences[ref.sentence];
    const token = sen?.tokens[ref.index];
    if (!sen || !token) return;
    setSelected(ref.sentence);
    setLooked({ ...ref, kind: coveringSpan(sen, token) ? "grammar" : "token" });
    if (token.entSeq !== undefined) lookup.load(token.entSeq, token.surface, token.reading);

    const holdMs = reading.state.status === "ready" ? reading.state.settings.lookupHoldMs : 800;
    const { pageX, pageY } = e.nativeEvent;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      const span = coveringSpan(sen, token);
      const listsReady = lists.state.status === "ready";
      const listsState = lists.state;
      const defaultName =
        listsState.status === "ready"
          ? listsState.lists.find((l) => l.id === listsState.defaultListId)?.name
          : undefined;
      setMenu({ ref, x: pageX, y: pageY, options: menuOptions(token, span, listsReady, defaultName) });
      // The hold *is* the menu opening on mobile: one signal covers both,
      // and unlinked words simply signal nothing.
      const signal = holdSignal(token, span);
      if (signal) reportSignals([signal]);
    }, holdMs);
  };

  /** Finger up: before the threshold this is a tap; after it, the option under the release runs. */
  const onTokenRelease = (ref: TokenRef, e: NativeSyntheticEvent<NativeTouchEvent>) => {
    cancelHold();
    if (!menu || !sameRef(menu.ref, ref)) return;
    const rects: Partial<Record<MenuOptionId, Rect>> = {};
    for (const option of menu.options) {
      const rect = menuRects?.get(`menu-option-${option.id}`);
      if (rect) rects[option.id] = rect;
    }
    const picked = optionAt(rects, menu.options, e.nativeEvent.pageX, e.nativeEvent.pageY);
    closeMenu();
    if (!picked) return; // released outside every live option: the menu just closes
    runMenuOption(picked, ref);
  };

  const onTokenTerminate = (ref: TokenRef) => {
    cancelHold();
    if (menu && sameRef(menu.ref, ref)) closeMenu();
  };

  const runMenuOption = (option: MenuOptionId, ref: TokenRef) => {
    const sen = story.sentences[ref.sentence];
    const token = sen?.tokens[ref.index];
    if (!sen || !token) return;
    const span = coveringSpan(sen, token);
    if (option === "dictionary") {
      setWindows((w) => [...w, { ...ref, kind: "token" }]);
      return;
    }
    if (option === "grammar") {
      setWindows((w) => [...w, { ...ref, kind: "grammar" }]);
      return;
    }
    const item = saveableItem(token, span);
    if (!item) return;
    if (option === "save") {
      void saveInto(lists.state.status === "ready" ? lists.state.defaultListId : null, item);
      return;
    }
    setSheetToken(ref);
  };

  const saveInto = async (listId: string | null, item: { kind: "vocabulary" | "grammar"; ref: string }) => {
    const targetList = lists.state.status === "ready" ? lists.state.lists.find((l) => l.id === listId) : undefined;
    if (!targetList) {
      setSaveNote("Could not save — Your Item Lists are still loading");
      return;
    }
    setSaveNote(null);
    const res = await lists.addToList(targetList.id, { itemKind: item.kind, itemRef: item.ref });
    if (res.ok) {
      setSaveNote(`Saved to ${targetList.name}.`);
      setSheetToken(null);
      setSheetError(null);
    } else {
      setSaveNote(`Could not save — ${res.message}`);
    }
  };

  const tokenHandlers = (sentenceIndex: number, index: number): TokenHandlers => {
    const ref: TokenRef = { sentence: sentenceIndex, index };
    return {
      onStartShouldSetResponder: () => true,
      onResponderGrant: (e) => onTokenGrant(ref, e),
      // Sliding only moves the finger: the release point decides, so the
      // menu itself stays anchored at the press.
      onResponderMove: () => {},
      onResponderRelease: (e) => onTokenRelease(ref, e),
      onResponderTerminate: () => onTokenTerminate(ref),
    };
  };

  // Android Back unwinds one layer at a time, and only one listener is ever
  // attached (issue #13's pattern), so a press can never pop twice.
  useHardwareBack(true, () => {
    if (sheetToken) {
      setSheetToken(null);
      return;
    }
    if (windows.length > 0) {
      setWindows((w) => w.slice(0, -1));
      return;
    }
    if (menu) {
      closeMenu();
      return;
    }
    onBack();
  });

  const top = windows.length > 0 ? windows[windows.length - 1] : null;
  const topSentence = top ? story.sentences[top.sentence] : undefined;
  const topToken = topSentence?.tokens[top?.index ?? -1];
  const topSpan = top && top.kind === "grammar" && topSentence && topToken ? coveringSpan(topSentence, topToken) : null;
  const topEntry =
    top && top.kind === "token" && topToken?.entSeq !== undefined
      ? lookup.peek(topToken.entSeq, topToken.surface, topToken.reading)
      : undefined;
  const topVocabLinked = top?.kind === "token" && topToken?.entSeq !== undefined;

  const measure = useCallback((testID: string, node: MeasurableNode | null): Rect | null => {
    if (!node) return null;
    let rect: Rect | null = null;
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      rect = { x, y, width, height };
    });
    return rect;
  }, []);

  return (
    <View
      style={styles.fill}
      onLayout={(e) => setScreen({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      accessibilityLabel="Story reader"
    >
      <View style={[styles.header, { borderBottomColor: colors.separator }]}>
        <Pressable
          testID="back-to-library"
          accessibilityRole="button"
          accessibilityLabel="Back to library"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={{ color: colors.accent, fontSize: 16 }}>‹ Library</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.label }]} numberOfLines={1}>
          {story.genre}
        </Text>
        {saveNote ? (
          <Text testID="save-note" style={{ color: colors.subtle, fontSize: 13 }} numberOfLines={1}>
            {saveNote}
          </Text>
        ) : null}
        <RatingButtons view={view} storyId={story.id} rating={story.rating} />
      </View>

      <ScrollView style={styles.fill} accessibilityLabel="Story text">
        {story.sentences.map((sen, i) => (
          <StoryParagraph
            key={i}
            sentence={sen}
            sentenceIndex={i}
            activeToken={looked}
            handlers={(index) => tokenHandlers(i, index)}
            onSelect={() => setSelected(i)}
          />
        ))}
        {view.questions.length > 0 ? (
          <View style={styles.questions}>
            <Text style={{ color: colors.subtle, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>
              COMPREHENSION
            </Text>
            {view.questions.map((q) => (
              <View key={q.position} style={styles.question}>
                <Text style={{ color: colors.label, fontSize: 16 }}>{q.promptJa}</Text>
                <View style={styles.options}>
                  {q.optionsJa.map((option, j) => (
                    <Pressable
                      key={j}
                      accessibilityRole="button"
                      accessibilityLabel={`Answer ${j + 1}: ${option}`}
                      accessibilityState={{ disabled: q.result !== null }}
                      disabled={q.result !== null}
                      onPress={() => void view.answer(q.position, j)}
                      style={[styles.optionButton, { borderColor: colors.separator, backgroundColor: colors.card }]}
                    >
                      <Text style={{ color: colors.label, fontSize: 15 }}>{option}</Text>
                    </Pressable>
                  ))}
                </View>
                {q.result ? (
                  <Text style={{ color: q.result.correct ? colors.accent : colors.danger, fontSize: 14 }}>
                    {q.result.correct ? "Correct." : "Not quite — the answer is above your selection."}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ReadingPanel
        story={story}
        selected={selected}
        looked={looked}
        reading={reading}
        lookup={lookup}
        onUnblur={onUnblur}
      />

      {menu && screen.width > 0 ? (
        <TokenMenu
          options={menu.options}
          x={menu.x}
          y={menu.y}
          screenWidth={screen.width}
          screenHeight={screen.height}
          measure={measure}
          onRects={setMenuRects}
        />
      ) : null}

      {top ? (
        top.kind === "grammar" && topSpan ? (
          <GrammarWindow span={topSpan} onClose={() => setWindows((w) => w.slice(0, -1))} />
        ) : topVocabLinked && topEntry ? (
          // The entry was primed the moment the token was pressed; while a
          // cold entry is still in flight the window simply is not up yet.
          <DictionaryWindow entry={topEntry} onClose={() => setWindows((w) => w.slice(0, -1))} />
        ) : null
      ) : null}

      {sheetToken && lists.state.status === "ready" ? (
        <SaveToSheet
          lists={lists.state.lists}
          defaultListId={lists.state.defaultListId}
          busy={sheetBusy}
          error={sheetError}
          onClose={() => {
            setSheetToken(null);
            setSheetError(null);
          }}
          onSaveToList={(listId) => {
            const sen = story.sentences[sheetToken.sentence];
            const token = sen?.tokens[sheetToken.index];
            const item = token ? saveableItem(token, sen ? coveringSpan(sen, token) : null) : null;
            if (!item) return;
            setSheetBusy(true);
            void saveInto(listId, item).finally(() => setSheetBusy(false));
          }}
          onCreateAndSave={(name) => {
            const sen = story.sentences[sheetToken.sentence];
            const token = sen?.tokens[sheetToken.index];
            const item = token ? saveableItem(token, sen ? coveringSpan(sen, token) : null) : null;
            if (!item) return;
            setSheetBusy(true);
            void lists
              .createList({ name, boosting: false })
              .then((created) => {
                // Create-then-save only after a successful create, as on the web.
                if (created.ok && created.list) return saveInto(created.list.id, item);
                setSheetError(created.ok ? "the new list vanished" : created.message);
                return undefined;
              })
              .finally(() => setSheetBusy(false));
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, paddingHorizontal: 12, minHeight: MIN_TOUCH },
  backButton: { paddingVertical: 10, paddingRight: 8 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  questions: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "transparent" },
  question: { marginBottom: 16, gap: 6 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionButton: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: MIN_TOUCH },
});
