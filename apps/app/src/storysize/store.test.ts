import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createStoryTextSizeStore,
  DEFAULT_STORY_TEXT_SIZE,
  parseStoryTextSize,
  STORY_TEXT_SIZES,
  STORY_TEXT_LINE_HEIGHT_RATIO,
  STORY_TEXT_SIZE_PX,
  STORY_TEXT_SIZE_STORAGE_KEY,
  storyColumnWidthPx,
} from "./store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  return {
    data,
    writes,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      writes.push([key, value]);
      data.set(key, value);
    },
  };
}

describe("parseStoryTextSize", () => {
  it("accepts the four saved sizes", () => {
    for (const size of STORY_TEXT_SIZES) {
      expect(parseStoryTextSize(size)).toBe(size);
      expect(parseStoryTextSize(size.toLowerCase())).toBe(size);
    }
  });

  it("falls back to the default for anything else", () => {
    expect(parseStoryTextSize(null)).toBe(DEFAULT_STORY_TEXT_SIZE);
    expect(parseStoryTextSize("XXL")).toBe(DEFAULT_STORY_TEXT_SIZE);
    expect(parseStoryTextSize("")).toBe(DEFAULT_STORY_TEXT_SIZE);
  });
});

describe("the Story text size scale", () => {
  it("defaults to M", () => {
    expect(DEFAULT_STORY_TEXT_SIZE).toBe("M");
  });

  it("keeps the JS sizes identical to the --text-story-* tokens in packages/design", () => {
    // JS sizes the column, the panel and the furigana off these numbers; the
    // text itself comes from CSS. A drift between the two is a layout bug,
    // so the test that catches it lives here.
    const css = readFileSync(path.join(__dirname, "../../../../packages/design/native.css"), "utf8");
    for (const size of STORY_TEXT_SIZES) {
      const match = css.match(new RegExp(`--text-story-${size.toLowerCase()}:\\s*(\\d+(?:\\.\\d+)?)px`));
      expect(match, `--text-story-${size} missing from packages/design/native.css`).not.toBeNull();
      expect(STORY_TEXT_SIZE_PX[size]).toBe(Number(match![1]));
    }
  });

  it("keeps the JS line heights identical to the --text-story-*--line-height tokens in packages/design", () => {
    // The reader paints every token and the panel's quoted sentence with its
    // own lineHeight, so the CSS line heights never reach those spans on
    // Android — JS must carry the same ratios.
    const css = readFileSync(path.join(__dirname, "../../../../packages/design/native.css"), "utf8");
    for (const size of STORY_TEXT_SIZES) {
      const match = css.match(
        new RegExp(`--text-story-${size.toLowerCase()}--line-height:\\s*(\\d+(?:\\.\\d+)?)`),
      );
      expect(match, `--text-story-${size}--line-height missing from packages/design/native.css`).not.toBeNull();
      expect(STORY_TEXT_LINE_HEIGHT_RATIO[size]).toBe(Number(match![1]));
    }
  });

  it("makes the text column 40 characters of Story text wide", () => {
    expect(storyColumnWidthPx("M")).toBe(40 * STORY_TEXT_SIZE_PX.M);
    expect(storyColumnWidthPx("XL")).toBe(40 * STORY_TEXT_SIZE_PX.XL);
  });
});

describe("createStoryTextSizeStore", () => {
  it("starts at the default size", () => {
    const store = createStoryTextSizeStore(fakeStorage());
    expect(store.getSnapshot()).toEqual({ size: "M" });
  });

  it("hydrates the saved size", async () => {
    const store = createStoryTextSizeStore(fakeStorage({ [STORY_TEXT_SIZE_STORAGE_KEY]: "L" }));
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ size: "L" });
  });

  it("hydrates to the default when nothing is saved", async () => {
    const store = createStoryTextSizeStore(fakeStorage());
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ size: "M" });
  });

  it("persists and notifies on setSize", async () => {
    const storage = fakeStorage();
    const store = createStoryTextSizeStore(storage);
    await store.hydrate();

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.setSize("XL");
    expect(store.getSnapshot()).toEqual({ size: "XL" });
    expect(notified).toBe(1);
    expect(storage.writes).toEqual([[STORY_TEXT_SIZE_STORAGE_KEY, "XL"]]);

    unsubscribe();
    store.setSize("S");
    expect(notified).toBe(1);
  });

  it("hydrates once", async () => {
    let reads = 0;
    const storage = {
      getItem: async (key: string) => {
        reads += 1;
        return fakeStorage().getItem(key);
      },
      setItem: async () => {},
    };
    const store = createStoryTextSizeStore(storage);
    await Promise.all([store.hydrate(), store.hydrate()]);
    expect(reads).toBe(1);
  });
});
