export type StoryTextSize = "S" | "M" | "L" | "XL";

export const STORY_TEXT_SIZES: StoryTextSize[] = ["S", "M", "L", "XL"];

export const DEFAULT_STORY_TEXT_SIZE: StoryTextSize = "M";

export const STORY_TEXT_SIZE_STORAGE_KEY = "vjt.storyTextSize";

export function parseStoryTextSize(value: string | null): StoryTextSize {
  const size = (value ?? "").trim().toUpperCase();
  return STORY_TEXT_SIZES.includes(size as StoryTextSize)
    ? (size as StoryTextSize)
    : DEFAULT_STORY_TEXT_SIZE;
}

/**
 * The px the Story text renders at, per size. This MUST mirror the
 * `--text-story-*` tokens in global.css (a test asserts it); JS needs the
 * numbers because the text column's width and the Reading Panel's height are
 * multiples of the story text size (plan 4.1), which the stylesheet cannot
 * compute.
 */
export const STORY_TEXT_SIZE_PX: Record<StoryTextSize, number> = {
  S: 18,
  M: 21,
  L: 24,
  XL: 28,
};

/**
 * Line height as a multiple of the text size, per size. This MUST mirror the
 * unitless `--line-height` values under the web story styles in global.css
 * (a test asserts it); JS needs the numbers because every Story token carries
 * its own Text style, and a style sheet cannot reach those spans on Android.
 */
export const STORY_TEXT_LINE_HEIGHT_RATIO: Record<StoryTextSize, number> = {
  S: 2.0,
  M: 2.1,
  L: 2.2,
  XL: 2.2,
};

/**
 * The text column: ~40 characters of Story text wide (plan 4.1). A CJK
 * character's advance is one em, so 40 characters is 40 × the story font
 * size.
 */
export const STORY_COLUMN_CHARS = 40;

export function storyColumnWidthPx(size: StoryTextSize): number {
  return STORY_COLUMN_CHARS * STORY_TEXT_SIZE_PX[size];
}

/** Storage seam, split per platform (web = localStorage, Android = SecureStore). */
export interface StoryTextSizeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface StoryTextSizeState {
  size: StoryTextSize;
}

/**
 * Same shape as the theme store (issue #42): a small external store Settings
 * and the reader subscribe to. Unlike the ThemeProvider, the app renders
 * while the stored size loads — the size only relayouts the reader, which is
 * always a navigation away, so a wrong first frame is not possible in
 * practice and gating startup is not worth the SecureStore round-trip.
 */
export function createStoryTextSizeStore(storage: StoryTextSizeStorage) {
  let state: StoryTextSizeState = { size: DEFAULT_STORY_TEXT_SIZE };
  const listeners = new Set<() => void>();
  let hydrating: Promise<void> | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): StoryTextSizeState {
      return state;
    },

    /** Reads the saved size once. */
    hydrate(): Promise<void> {
      if (!hydrating) {
        hydrating = storage
          .getItem(STORY_TEXT_SIZE_STORAGE_KEY)
          .then((saved) => {
            state = { size: parseStoryTextSize(saved) };
          })
          .catch(() => {
            state = { size: DEFAULT_STORY_TEXT_SIZE };
          })
          .then(emit);
      }
      return hydrating;
    },

    setSize(size: StoryTextSize): void {
      state = { size };
      emit();
      void storage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, size);
    },
  };
}
