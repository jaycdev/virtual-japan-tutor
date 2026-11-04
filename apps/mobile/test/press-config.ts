import { act } from "@testing-library/react";

// react-native-web's PressResponder (usePressEvents) takes a Pressable's
// `disabled` from configure(), which runs in a passive useEffect, and its click
// handler reads that stored value, not the DOM. A click dispatched after the
// commit that enables a control, but before the effect flushes, is dropped.
// Call this after a wait and before pressing a control that data or state just
// enabled. Do not replace it with a check on aria-disabled: that is already
// correct at commit, so the check passes without protecting the press.
export async function flushPressConfig(): Promise<void> {
  await act(async () => {});
}
