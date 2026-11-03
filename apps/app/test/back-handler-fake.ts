import { act } from '@testing-library/react';

import type { BackHandlerLike } from '../src/hardwareBack.ts';

/**
 * A stand-in for Android's BackHandler: press() runs the registered
 * hardwareBackPress listeners (inside act) and reports whether one consumed
 * the press — false means the app would take the default action and exit.
 */
export interface FakeBackHandler extends BackHandlerLike {
  press(): boolean;
}

export function fakeBackHandler(): FakeBackHandler {
  const listeners = new Set<() => boolean>();
  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    press() {
      let handled = false;
      act(() => {
        for (const listener of listeners) if (listener()) handled = true;
      });
      return handled;
    },
  };
}
