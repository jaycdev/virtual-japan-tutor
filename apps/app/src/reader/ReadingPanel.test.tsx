import type { Story } from "@vjt/api-client";
import type { ReadingSettingsView } from "@vjt/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EntryLookup } from "./useEntryLookup.ts";
import { ReadingPanel, type LookedTarget } from "./ReadingPanel.tsx";

/**
 * Direct unit tests of the Reading Panel (issue #14 review): the shrink step
 * is decided by the sentence's *content* height versus the fixed box — a
 * ScrollView's onLayout only ever reports the box, so jsdom never fires
 * anything useful. The tests inject the measured content height through
 * `sentenceContentHeight` and read the styles off the React fiber, which is
 * the only place StyleSheet values are visible in the test host.
 */

const story = {
  id: "st-1",
  genre: "diary",
  createdAt: "2026-11-01T09:00:00Z",
  sentences: [
    {
      ja: "がっこうでべんきょうしました。",
      en: "I studied at school.",
      tokens: [
        { surface: "がっこう", start: 0, end: 4, reading: "がっこう", entSeq: 990101, tag: "known", showFurigana: false },
        { surface: "で", start: 4, end: 5, reading: "で", entSeq: 990102, tag: "unknown", showFurigana: false },
      ],
      grammarSpans: [],
    },
    {
      ja: "みせにいきました。",
      en: "I went to the shop.",
      tokens: [{ surface: "みせ", start: 0, end: 2, reading: "みせ", entSeq: 990103, tag: "unknown", showFurigana: false }],
      grammarSpans: [],
    },
  ],
  vocabItems: [],
} as unknown as Story;

const reading: ReadingSettingsView = {
  state: { status: "ready", settings: { blurTranslation: true, lookupHoldMs: 800 } },
  setBlurTranslation: async () => ({ ok: true }),
  setLookupHoldMs: async () => ({ ok: true }),
  reload: () => {},
};

const lookup: EntryLookup = { load: () => {}, peek: () => undefined, failed: () => false, invalidate: () => {} };

/**
 * Reads a CSS value off what react-native-web actually rendered: r-* classes
 * on the element, resolved through the generated stylesheets. This is what a
 * real host would paint, so it also proves the style survived the bridge.
 */
function renderedValue(testID: string, prop: string): string | undefined {
  const el = screen.getByTestId(testID);
  for (const cls of Array.from(el.classList)) {
    if (!cls.startsWith("r-")) continue; // r-* classes are the ones our styles generate
    for (const style of Array.from(document.querySelectorAll("style"))) {
      for (const rule of Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])) {
        if ((rule as CSSStyleRule).selectorText === `.${cls}`) {
          const v = (rule as CSSStyleRule).style.getPropertyValue(prop);
          if (v) return v;
        }
      }
    }
  }
  return undefined;
}

function renderPanel(opts: { selected: number | null; looked?: LookedTarget | null; sentenceContentHeight?: number }) {
  return render(
    <ReadingPanel
      story={story}
      selected={opts.selected}
      looked={opts.looked ?? null}
      reading={reading}
      lookup={lookup}
      onUnblur={() => {}}
      sentenceContentHeight={opts.sentenceContentHeight}
    />,
  );
}

describe("Reading Panel shrink and fixed size (review fixes)", () => {
  it("shrinks a sentence whose measured content overflows the box", () => {
    renderPanel({ selected: 0, sentenceContentHeight: 400 });
    expect(renderedValue("panel-sentence", "font-size")).toBe("15px");
  });

  it("resets the shrink when the selected sentence changes, and decides again per sentence", () => {
    const { rerender } = renderPanel({ selected: 0, sentenceContentHeight: 400 });
    expect(renderedValue("panel-sentence", "font-size")).toBe("15px");

    // A short sentence selected next must NOT inherit the previous shrink.
    rerender(
      <ReadingPanel
        story={story}
        selected={1}
        looked={null}
        reading={reading}
        lookup={lookup}
        onUnblur={() => {}}
        sentenceContentHeight={40}
      />,
    );
    expect(renderedValue("panel-sentence", "font-size")).toBe("18px");

    // Back to the first sentence with a content height that fits: the shrink
    // was reset when the selection changed, and the new measurement fits.
    rerender(
      <ReadingPanel
        story={story}
        selected={0}
        looked={null}
        reading={reading}
        lookup={lookup}
        onUnblur={() => {}}
        sentenceContentHeight={40}
      />,
    );
    expect(renderedValue("panel-sentence", "font-size")).toBe("18px");
  });

  it("a long sentence cannot grow the panel while it is in word-mode", () => {
    renderPanel({ selected: 0, looked: { sentence: 0, index: 0, kind: "token" }, sentenceContentHeight: 9999 });
    // One fixed box: the panel's own height is a dp constant, not content-driven.
    expect(renderedValue("reading-panel", "height")).toBe("148px");
    // Word-mode shows the lookup, and the long sentence is not rendered at
    // all — there is nothing that could grow the fixed box.
    expect(screen.getByText("Word meaning")).toBeTruthy();
    expect(screen.queryByTestId("panel-sentence")).toBeNull();
  });
});
