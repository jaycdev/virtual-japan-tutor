import { useEffect, useSyncExternalStore } from "react";

import { storyTextSizeStorage } from "./storage.ts";
import {
  createStoryTextSizeStore,
  DEFAULT_STORY_TEXT_SIZE,
  storyColumnWidthPx,
  STORY_TEXT_LINE_HEIGHT_RATIO,
  STORY_TEXT_SIZE_PX,
  type StoryTextSize,
  type StoryTextSizeState,
} from "./store.ts";

export type { StoryTextSize };

// Module-scope singleton, mirroring the theme store: the size is one setting
// for the whole app, read by the reader's layout and (issue #50) Settings.
const store = createStoryTextSizeStore(storyTextSizeStorage);

const SERVER_SNAPSHOT: StoryTextSizeState = { size: DEFAULT_STORY_TEXT_SIZE };

/**
 * Hydrates the stored Story text size at app start and re-renders when it
 * changes. Unlike the ThemeProvider this never gates the first frame: the
 * size only relayouts the Story reader, which is always a navigation away.
 */
export function StoryTextSizeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void store.hydrate();
  }, []);
  return <>{children}</>;
}

export interface StoryTextSizeSetting {
  size: StoryTextSize;
  /** The px the Story text renders at (mirrors `--text-story-*` in global.css). */
  fontSizePx: number;
  /** The line height matching that size (mirrors `--text-story-*--line-height`). */
  lineHeightPx: number;
  /** The text column: 40 characters of Story text wide (plan 4.1). */
  columnWidthPx: number;
  setSize: (size: StoryTextSize) => void;
}

export function useStoryTextSize(): StoryTextSizeSetting {
  const state = useSyncExternalStore<StoryTextSizeState>(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
  return {
    size: state.size,
    fontSizePx: STORY_TEXT_SIZE_PX[state.size],
    lineHeightPx: Math.round(STORY_TEXT_SIZE_PX[state.size] * STORY_TEXT_LINE_HEIGHT_RATIO[state.size]),
    columnWidthPx: storyColumnWidthPx(state.size),
    setSize: store.setSize,
  };
}
