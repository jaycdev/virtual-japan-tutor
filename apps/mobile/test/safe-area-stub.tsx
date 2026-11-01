// jsdom stand-in for react-native-safe-area-context: its package entry for React
// Native points at TypeScript sources (which vitest loads as JS), and its native
// module cannot run in jsdom anyway. The screens only need inset numbers.
import type { ReactNode } from "react";

export function SafeAreaProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: 800, height: 1280 };
}

export function SafeAreaView({ children }: { children: ReactNode }) {
  return children;
}

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 800, height: 1280 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};
