// The Story text size setting (ported from apps/mobile/src/storysize/store.ts, #45).
// S / M / L / XL, saved per device. The px values live in packages/design as the
// --text-story-* tokens; on web the chosen size is exposed as the CSS variable
// --story-text-size (see index.css), which the reader will use.

export type StoryTextSize = "S" | "M" | "L" | "XL";

export const STORY_TEXT_SIZES: StoryTextSize[] = ["S", "M", "L", "XL"];

export const DEFAULT_STORY_TEXT_SIZE: StoryTextSize = "M";

export const STORY_TEXT_SIZE_STORAGE_KEY = "vjt.storyTextSize";

export function parseStoryTextSize(value: string | null): StoryTextSize {
  const size = (value ?? "").trim().toUpperCase();
  return STORY_TEXT_SIZES.includes(size as StoryTextSize) ? (size as StoryTextSize) : DEFAULT_STORY_TEXT_SIZE;
}

export interface StoryTextSizeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface StoryTextSizeState {
  size: StoryTextSize;
}

/** Same shape as the theme store: a small external store the settings and the reader subscribe to. */
export function createStoryTextSizeStore(storage: StoryTextSizeStorage, applySize: (size: StoryTextSize) => void = () => {}) {
  let state: StoryTextSizeState = { size: DEFAULT_STORY_TEXT_SIZE };
  const listeners = new Set<() => void>();
  let hydrating: Promise<void> | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
          .then(() => {
            applySize(state.size);
            emit();
          });
      }
      return hydrating;
    },

    setSize(size: StoryTextSize): void {
      state = { size };
      applySize(size);
      emit();
      storage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, size).catch(() => {
        // Storage refused: the size lasts this visit only.
      });
    },
  };
}
