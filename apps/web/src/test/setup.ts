import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Loaded CI runners can take far longer than the 1000 ms default to render a
// screen; a wait that is already satisfied still returns immediately.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no matchMedia; the theme code asks it for prefers-color-scheme.
// Tests that need a specific answer replace it with their own stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom has no PointerEvent, and Radix menus read pointer properties off the
// event user-event dispatches; without this the trigger never opens.
if (!("PointerEvent" in globalThis)) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (globalThis as Record<string, unknown>).PointerEvent = PointerEventPolyfill;
}

// Radix dialogs guard their focus handling with pointer capture, which jsdom
// does not implement.
type PointerCapturePatch = {
  hasPointerCapture: (pointerId: number) => boolean;
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
};
if (!("hasPointerCapture" in HTMLElement.prototype)) {
  const proto = HTMLElement.prototype as unknown as PointerCapturePatch;
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  delete document.documentElement.dataset.storyTextSize;
});
