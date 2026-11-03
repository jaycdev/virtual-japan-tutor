import type { ReactNode } from "react";

// react-native-screens binds to the native navigation host. Only
// FullWindowOverlay (iOS-only in the RNR components) is imported by code
// under test, so it becomes a pass-through fragment here.
export function FullWindowOverlay({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export default { FullWindowOverlay };
