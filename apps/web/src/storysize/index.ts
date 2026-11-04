import { useSyncExternalStore } from "react";

import { localKeyValueStore } from "../storage.ts";
import { createStoryTextSizeStore, type StoryTextSize } from "./store.ts";

/**
 * Publishes the size on <html data-story-text-size>; index.css maps it to the
 * --story-text-size and --story-line-height variables the reader reads.
 */
export function applyStoryTextSizeToDocument(size: StoryTextSize): void {
  document.documentElement.dataset.storyTextSize = size;
}

export const storyTextSizeStore = createStoryTextSizeStore(localKeyValueStore, applyStoryTextSizeToDocument);

export function useStoryTextSize(): { size: StoryTextSize; setSize: (size: StoryTextSize) => void } {
  const state = useSyncExternalStore(storyTextSizeStore.subscribe, storyTextSizeStore.getSnapshot);
  return { size: state.size, setSize: storyTextSizeStore.setSize };
}
