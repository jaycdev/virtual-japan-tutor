import type { ApiClient, Story, WeakSignalRequest } from "@vjt/api-client";
import { type StoryView, useItemLists, useReadingSettings } from "@vjt/core";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
} from "react-native";

import { useHardwareBack } from "../useHardwareBack.ts";
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
  IDLE,
  menuOptions,
  optionAt,
  reduceHold,
  saveableItem,
  type MeasurableNode,
  type MenuOptionId,
  type Rect,
  type TokenRef,
} from "./holdMenu.ts";

/**
 * The mobile Story reader (issue #14): a fixed Reading Panel sits above the
 * story, which scrolls under it. Pressing a token selects its sentence,
 * switches the panel to word-mode for that word, and starts the hold timer.
 * The gesture itself runs on the pure holdMenu machine (reduceHold through
 * useReducer), so the machine's unit tests guard shipped code: a hold past
 * lookupHoldMs opens the Lookup Menu at the finger — that hold is the Weak
 * Signal — and lifting over a menu option runs it (Dictionary / Grammar open
 * centred windows, Save writes to the Default List, Save to… opens the bottom
 * sheet); anywhere else the release cancels.
 *
 * Scrolling vs. the gesture (issue #14 review): the story ScrollView is only
 * frozen while the Lookup Menu is up. A swipe that merely starts on text,
 * before any hold elapses, stays scrollable — the ScrollView takes the touch,
 * the token's responder is terminated, and the reducer's cancel guard means
 * the stale timer cannot open a menu afterwards. Tokens therefore accept
 * termination requests except while their menu is open; once the menu is up
 * the scroll freeze plus the refusal protect slide-and-release. (Manual
 * checklist: verify swipe-to-scroll starting on text, and slide-and-release,
 * on a real Android device.)
 *
 * Android Back unwinds one layer at a time: sheet, then window, then menu,
 * then back out to whichever view opened the Story (Today's Story or the
 * Library).
 */

const sameRef = (a: TokenRef, b: TokenRef) => a.sentence === b.sentence && a.index === b.index;

export function StoryReader({
  client,
  view,
  story,
  onBack,
  measure: measureProp,
  screenSize,
}: {
  client: ApiClient;
  view: StoryView;
  story: Story;
  onBack: () => void;
  /** Overrides the menu measuring (jsdom reports no geometry — tests inject rects). */
  measure?: (testID: string, node: MeasurableNode | null) => Rect | null;
  /** Overrides the measured viewport for menu anchoring (same reason). */
  screenSize?: { width: number; height: number };
}) {
  const colors = useColors();
  const reading = useReadingSettings(client);
  const lists = useItemLists(client);
  const lookup = useEntryLookup(client);

  const [selected, setSelected] = useState<number | null>(null);
  // The title's English translation reveals transiently in the header too
  // (issue #34 parity): never saved, never a Weak Signal.
  const [titleEnRevealed, setTitleEnRevealed] = useState(false);
  // The whole press → hold → menu gesture is one reducer (holdMenu.reduceHold):
  // phase, token, finger point and press anchor. menu / looked (panel
  // word-mode) / the scroll freeze all DERIVE from it, and the timer's
  // holdElapsed is ignored unless the state is still `press` — so a scroll
  // that terminated the responder can never be followed by a menu opening
  // behind the Learner's finger.
  const [gesture, dispatch] = useReducer(reduceHold, IDLE);
  const [menuRects, setMenuRects] = useState<Map<string, Rect> | null>(null);
  const [windows, setWindows] = useState<LookedTarget[]>([]);
  const [sheetToken, setSheetToken] = useState<TokenRef | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const saveBusyRef = useRef(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  // The reader view's window origin (see the menu-position effect): pageX/
  // pageY arrive in window coordinates, but TokenMenu positions itself
  // absolutely inside this view, which sits below the safe-area padding.
  const [viewOrigin, setViewOrigin] = useState<{ x: number; y: number } | null>(null);

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => cancelHold, []);

  // The save note fades on its own; clearing the timer on change/unmount
  // keeps a stale note from wiping a fresh one (issue #14 review, minor 9).
  useEffect(() => {
    if (!saveNote) return;
    const fade = setTimeout(() => setSaveNote(null), 5000);
    return () => clearTimeout(fade);
  }, [saveNote]);

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

  // --- state derived from the gesture reducer ------------------------------

  const pressedToken =
    gesture.token !== null ? story.sentences[gesture.token.sentence]?.tokens[gesture.token.index] : undefined;

  // A failed lookup (null cached) dims the Dictionary row until the retry (nit 2/3).
  const dictionaryFailed =
    pressedToken?.entSeq !== undefined &&
    lookup.failed(pressedToken.entSeq, pressedToken.surface, pressedToken.reading);

  // The Reading Panel's word-mode follows the machine: the pressed token is
  // "looked at" from press until cancel (release, terminate, or Back).
  const looked: LookedTarget | null = useMemo(() => {
    if (!gesture.token) return null;
    const sen = story.sentences[gesture.token.sentence];
    const tok = sen?.tokens[gesture.token.index];
    if (!sen || !tok) return null;
    return { ...gesture.token, kind: coveringSpan(sen, tok) ? "grammar" : "token" };
  }, [gesture.token, story]);

  const menuOpen = gesture.phase === "menu";
  // The scroll freeze belongs to the menu alone: before it, the story stays
  // scrollable so a swipe on text pans instead of hijacking the word.
  const scrollEnabled = !menuOpen;

  // Menu contents recompute while the menu is open (Item Lists may still be
  // loading, a failed dictionary lookup dims Dictionary until the retry).
  const openOptions = useMemo(() => {
    if (gesture.phase !== "menu" || !gesture.token) return [];
    const sen = story.sentences[gesture.token.sentence];
    const tok = sen?.tokens[gesture.token.index];
    if (!sen || !tok) return [];
    const listsState = lists.state;
    const defaultName =
      listsState.status === "ready"
        ? listsState.lists.find((l) => l.id === listsState.defaultListId)?.name
        : undefined;
    return menuOptions(
      tok,
      coveringSpan(sen, tok),
      listsState.status === "ready",
      defaultName,
      dictionaryFailed,
    );
  }, [gesture.phase, gesture.token, story, lists.state, dictionaryFailed]);

  // --- gesture handlers ------------------------------------------------------

  const closeMenu = () => {
    cancelHold();
    dispatch({ type: "cancel" });
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
    dispatch({ type: "press", token: ref, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
    if (token.entSeq !== undefined) lookup.load(token.entSeq, token.surface, token.reading);

    // The timer only reads the reducer (through gestureRef) and the immutable
    // press data (the Story never changes while it is open) — never captured
    // Item Lists or Reading Settings, which arrive after the press. The menu
    // options those need are derived at render instead (see openOptions),
    // so nothing here can go stale (issue #14 review, minor 7).
    const holdMs = reading.state.status === "ready" ? reading.state.settings.lookupHoldMs : 800;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      const g = gestureRef.current;
      if (g.phase !== "press" || !g.token || !sameRef(g.token, ref)) return; // released or stolen
      dispatch({ type: "holdElapsed" });
      // The hold *is* the menu opening on mobile: one signal covers both,
      // and unlinked words simply signal nothing.
      const signal = holdSignal(token, coveringSpan(sen, token));
      if (signal) reportSignals([signal]);
    }, holdMs);
  };

  /** Finger up: before the threshold this is a tap; after it, the option under the release runs. */
  const onTokenRelease = (ref: TokenRef, e: NativeSyntheticEvent<NativeTouchEvent>) => {
    cancelHold();
    const g = gestureRef.current;
    if (g.phase !== "menu" || !g.token || !sameRef(g.token, ref)) {
      dispatch({ type: "cancel" }); // a tap: the panel returns to sentence-mode
      return;
    }
    const rects: Partial<Record<MenuOptionId, Rect>> = {};
    for (const option of openOptionsRef.current) {
      const rect = menuRects?.get(`menu-option-${option.id}`);
      if (rect) rects[option.id] = rect;
    }
    const picked = optionAt(rects, openOptionsRef.current, e.nativeEvent.pageX, e.nativeEvent.pageY);
    closeMenu();
    if (!picked) return; // released outside every live option: the menu just closes
    runMenuOption(picked, ref);
  };

  /** The responder was taken (a scroll swipe panned the story): abandon the gesture. */
  const onTokenTerminate = (ref: TokenRef) => {
    cancelHold();
    const g = gestureRef.current;
    if (g.phase === "menu" && g.token && sameRef(g.token, ref)) closeMenu();
    else dispatch({ type: "cancel" });
  };

  const runMenuOption = (option: MenuOptionId, ref: TokenRef) => {
    const sen = story.sentences[ref.sentence];
    const token = sen?.tokens[ref.index];
    if (!sen || !token) return;
    const span = coveringSpan(sen, token);
    if (option === "dictionary") {
      // Only push the window when the entry is actually there: a window
      // pushed over an empty lookup would render nothing and make the first
      // Back pop an invisible layer (issue #14 review, major 3). Failure is
      // not reachable here — a failed lookup dims the row, so optionAt never
      // picks it — this guard only covers a lookup still in flight.
      if (token.entSeq === undefined || lookup.peek(token.entSeq, token.surface, token.reading) === undefined) return;
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

  const saveInto = async (
    listId: string | null,
    item: { kind: "vocabulary" | "grammar"; ref: string },
    nameHint?: string,
  ) => {
    if (!listId) {
      setSaveNote("Could not save — Your Item Lists are still loading");
      return;
    }
    if (saveBusyRef.current) return; // one save at a time, menu path and sheet path alike
    saveBusyRef.current = true;
    setSaveBusy(true);
    setSaveNote(null);
    try {
      const res = await lists.addToList(listId, { itemKind: item.kind, itemRef: item.ref });
      if (res.ok) {
        // A just-created list may not be in this callback's captured state yet —
        // the create hands back its name, so the note is honest either way.
        const found = lists.state.status === "ready" ? lists.state.lists.find((l) => l.id === listId)?.name : undefined;
        setSaveNote(`Saved to ${found ?? nameHint ?? "your list"}.`);
        setSheetToken(null);
        setSheetError(null);
      } else {
        setSaveNote(`Could not save — ${res.message}`);
      }
    } finally {
      saveBusyRef.current = false;
      setSaveBusy(false);
    }
  };

  // --- stable per-token handlers --------------------------------------------
  // Token props (and StoryParagraph props) keep identical identity across
  // gesture renders: handler objects are built once per token and read the
  // current closures through refs, so React.memo(StoryParagraph) actually
  // skips paragraphs that a header note or panel update cannot change.

  const gestureRef = useRef(gesture);
  const openOptionsRef = useRef(openOptions);
  const actionsRef = useRef({ grant: onTokenGrant, release: onTokenRelease, terminate: onTokenTerminate });
  // The refs refresh after each commit (react-hooks forbids writing refs in
  // the render body). Every reader of them — the hold timer and the token
  // handlers — runs from a timer or a touch event, which always lands after
  // the effects have flushed, so they never see a stale closure.
  useEffect(() => {
    gestureRef.current = gesture;
    openOptionsRef.current = openOptions;
    actionsRef.current = { grant: onTokenGrant, release: onTokenRelease, terminate: onTokenTerminate };
  });

  // Handler objects are built ONCE per token (story is immutable while the
  // reader is open): the same identity every render, so React.memo on
  // StoryParagraph genuinely skips untouched paragraphs. The objects only
  // touch refs when an event fires, never during render (react-hooks/refs).
  const tokenHandlers = useMemo(() => {
    const make = (sentenceIndex: number, index: number): TokenHandlers => {
      const ref: TokenRef = { sentence: sentenceIndex, index };
      return {
        onStartShouldSetResponder: () => true,
        onResponderGrant: (e) => actionsRef.current.grant(ref, e),
        // Sliding only moves the finger: the release point decides, so the
        // menu itself stays anchored at the press.
        onResponderMove: () => {},
        onResponderRelease: (e) => actionsRef.current.release(ref, e),
        onResponderTerminate: () => actionsRef.current.terminate(ref),
        // Let a would-be stealer (the ScrollView panning a swipe) take the
        // responder, EXCEPT while this token's menu is open — then the scroll
        // is frozen anyway and the gesture must survive to the release.
        onResponderTerminationRequest: () => gestureRef.current.phase !== "menu",
      };
    };
    const bySentence = story.sentences.map((sen, i) => sen.tokens.map((_token, j) => make(i, j)));
    return (sentenceIndex: number, index: number) => bySentence[sentenceIndex][index];
  }, [story]);

  const selectSentence = useCallback((sentenceIndex: number) => setSelected(sentenceIndex), []);

  const top = windows.length > 0 ? windows[windows.length - 1] : null;
  const topSentence = top ? story.sentences[top.sentence] : undefined;
  const topToken = topSentence?.tokens[top?.index ?? -1];
  const topSpan = top && top.kind === "grammar" && topSentence && topToken ? coveringSpan(topSentence, topToken) : null;
  const topEntry =
    top && top.kind === "token" && topToken?.entSeq !== undefined
      ? lookup.peek(topToken.entSeq, topToken.surface, topToken.reading)
      : undefined;
  const topVocabLinked = top?.kind === "token" && topToken?.entSeq !== undefined;

  const closeTopWindow = () => {
    // Both close paths — the card's × and hardware Back — come through here,
    // so they behave identically (issue #14 quality nit 1). A window is only
    // ever pushed over a cached entry (see runMenuOption), so a successful
    // lookup stays cached across closes — no refetch flicker on the next
    // press. Only a key that is FAILED at close time is forgotten, so a
    // later hold retries it.
    if (
      top?.kind === "token" &&
      topToken?.entSeq !== undefined &&
      lookup.failed(topToken.entSeq, topToken.surface, topToken.reading)
    )
      lookup.invalidate(topToken.entSeq, topToken.surface, topToken.reading);
    setWindows((w) => w.slice(0, -1));
  };

  // Android Back unwinds one layer at a time, and only one listener is ever
  // attached (issue #13's pattern), so a press can never pop twice. The sheet
  // and windows are Modals whose onRequestClose also fires on Back: on Android
  // the dialog consumes the key press, so that path never reaches this
  // listener — the pairing is a deliberate double safety, not a double-pop.
  useHardwareBack(true, () => {
    if (sheetToken) {
      setSheetToken(null);
      return;
    }
    if (windows.length > 0) {
      closeTopWindow(); // the same path as the card's × (nit 1)
      return;
    }
    if (gesture.phase === "menu") {
      closeMenu();
      return;
    }
    onBack();
  });

  // Real measuring: RN hands refs a measureInWindow. The jsdom test host has
  // neither that method nor a viewport, so tests inject both (see props).
  // measureInWindow invokes its callback SYNCHRONOUSLY on Fabric — the only
  // architecture in RN 0.88 (the legacy arch was removed) — which is why
  // reading `rect` right after the call below is correct.
  const defaultMeasure = useCallback((testID: string, node: MeasurableNode | null): Rect | null => {
    if (!node || typeof node.measureInWindow !== "function") return null;
    let rect: Rect | null = null;
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      rect = { x, y, width, height };
    });
    return rect;
  }, []);
  const measure = measureProp ?? defaultMeasure;

  const rootViewRef = useRef<MeasurableNode | null>(null);

  return (
    <View
      ref={(node) => {
        rootViewRef.current = node;
      }}
      style={styles.fill}
      onLayout={(e) => {
        setScreen({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
        // The menu anchors on pageX/pageY (window coordinates) but positions
        // itself inside this view — under the safe-area paddingTop. Anchor on
        // view-local coordinates instead (issue #14 review, minor 4).
        const r = measure("reader-view", rootViewRef.current);
        setViewOrigin(r ? { x: r.x, y: r.y } : null);
      }}
      accessibilityLabel="Story reader"
    >
      <View style={[styles.header, { borderBottomColor: colors.separator }]}>
        <View style={styles.headerRow}>
          <Pressable
            testID="back-to-stories"
            accessibilityRole="button"
            accessibilityLabel="Back to stories"
            onPress={onBack}
            style={styles.backButton}
          >
            <ChevronLeft size={26} color={colors.accent} strokeWidth={2.5} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.label }]} numberOfLines={1}>
            {story.title}
          </Text>
          <Pressable
            testID="reader-read-toggle"
            accessibilityRole="button"
            accessibilityLabel={story.readAt != null ? "Unmark read" : "Mark read"}
            accessibilityState={{ disabled: view.pending }}
            disabled={view.pending}
            onPress={() => void (story.readAt != null ? view.clearRead(story.id) : view.setRead(story.id))}
            style={styles.readToggle}
          >
            <Text style={{ color: story.readAt != null ? colors.accent : colors.subtle, fontSize: 15 }}>
              {story.readAt != null ? "✓ Read" : "Read"}
            </Text>
          </Pressable>
          <RatingButtons view={view} storyId={story.id} rating={story.rating} />
        </View>
        <View style={styles.headerMeta}>
          {story.titleEn ? (
            <Pressable
              testID="reader-title-translation"
              accessibilityRole="button"
              accessibilityLabel="Title translation"
              accessibilityHint={titleEnRevealed ? "Tap to hide the translation" : "Tap to show the translation"}
              onPress={() => setTitleEnRevealed((v) => !v)}
              style={styles.titleTranslation}
            >
              {/* Same Android-safe trick as the Reading Panel: transparent text, no CSS blur. */}
              <Text style={{ color: titleEnRevealed ? colors.subtle : "transparent", fontSize: 13 }} numberOfLines={1}>
                {story.titleEn}
              </Text>
              {titleEnRevealed ? null : (
                <Text style={{ color: colors.subtle, fontSize: 11 }}>Title translation hidden — tap to show</Text>
              )}
            </Pressable>
          ) : null}
          <Text style={{ color: colors.subtle, fontSize: 12 }} numberOfLines={1}>
            {`${story.genre} · ${story.origin === "on_demand" ? "On demand" : "Automatic"} · ${new Date(story.createdAt).toDateString()}`}
          </Text>
          {saveNote ? (
            <Text testID="save-note" style={{ color: colors.subtle, fontSize: 13 }} numberOfLines={1}>
              {saveNote}
            </Text>
          ) : null}
        </View>
      </View>

      {/* The Reading Panel is the fixed area ABOVE the story (mirrors the web
          reader, Stories.tsx): the story scrolls under it, and the panel's
          one fixed box switches between sentence-mode and word-mode. */}
      <ReadingPanel
        story={story}
        selected={selected}
        looked={looked}
        reading={reading}
        lookup={lookup}
        onUnblur={onUnblur}
      />

      <ScrollView
        testID="story-scroll"
        style={styles.fill}
        scrollEnabled={scrollEnabled}
        accessibilityLabel="Story text"
      >
        {story.sentences.map((sen, i) => (
          <StoryParagraph
            key={i}
            sentence={sen}
            sentenceIndex={i}
            activeToken={looked !== null && looked.sentence === i ? looked : null}
            handlers={tokenHandlers}
            onSelect={selectSentence}
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

      {menuOpen && gesture.token && (screenSize ?? screen).width > 0 ? (
        <TokenMenu
          options={openOptions}
          x={gesture.anchorX - (viewOrigin?.x ?? 0)}
          y={gesture.anchorY - (viewOrigin?.y ?? 0)}
          screenWidth={(screenSize ?? screen).width}
          screenHeight={(screenSize ?? screen).height}
          measure={measure}
          onRects={setMenuRects}
        />
      ) : null}

      {top ? (
        top.kind === "grammar" && topSpan ? (
          <GrammarWindow span={topSpan} onClose={closeTopWindow} />
        ) : topVocabLinked && topEntry ? (
          // The window is only pushed when the entry is already cached (see
          // runMenuOption), so this renders with real content, never a stub.
          <DictionaryWindow entry={topEntry} onClose={closeTopWindow} />
        ) : null
      ) : null}

      {sheetToken && lists.state.status === "ready" ? (
        <SaveToSheet
          lists={lists.state.lists}
          defaultListId={lists.state.defaultListId}
          busy={saveBusy}
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
            void saveInto(listId, item);
          }}
          onCreateAndSave={(name) => {
            const sen = story.sentences[sheetToken.sentence];
            const token = sen?.tokens[sheetToken.index];
            const item = token ? saveableItem(token, sen ? coveringSpan(sen, token) : null) : null;
            if (!item) return;
            if (saveBusyRef.current) return;
            saveBusyRef.current = true;
            setSaveBusy(true);
            void lists
              .createList({ name, boosting: false })
              .then((created) => {
                // Create-then-save only after a successful create, as on the web.
                if (created.ok && created.list) {
                  saveBusyRef.current = false;
                  return saveInto(created.list.id, item, created.list.name);
                }
                setSheetError(created.ok ? "the new list vanished" : created.message);
                return undefined;
              })
              .finally(() => {
                saveBusyRef.current = false;
                setSaveBusy(false);
              });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: "column",
    gap: 2,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TOUCH,
  },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  backButton: { paddingVertical: 10, paddingRight: 8 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  readToggle: { paddingVertical: 8, paddingHorizontal: 4 },
  titleTranslation: { paddingVertical: 2 },
  questions: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "transparent" },
  question: { marginBottom: 16, gap: 6 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionButton: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: MIN_TOUCH },
});
