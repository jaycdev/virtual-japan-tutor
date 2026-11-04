import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The bottom safe-area inset every bottom sheet adds beneath its own padding.
 * Sheets are pinned to `bottom: 0` inside the Shell's PortalHost, so without it
 * the gesture bar sits over their last row. Every sheet reads this one hook
 * (TokenMenu, Windows, SaveToSheet, the Stories menu and dialogs).
 */
export function useSheetBottomInset(): number {
  return useSafeAreaInsets().bottom;
}
