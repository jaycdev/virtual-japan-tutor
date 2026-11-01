import { useColorScheme } from "react-native";

/** Minimum comfortable touch target on Android (dp). */
export const MIN_TOUCH = 44;

/**
 * A small semantic palette that follows the system light/dark setting (Appearance),
 * in the spirit of Material colours without pulling in a theme library. Screens use
 * `useColors()` so they re-render when the theme flips.
 */
const light = {
  background: "#f6f5f7",
  card: "#ffffff",
  label: "#1b1b1f",
  subtle: "#5f6368",
  accent: "#3949ab",
  onAccent: "#ffffff",
  danger: "#b3261e",
  success: "#1e7d3e",
  separator: "#d7d7dd",
  field: "#ffffff",
};

const dark = {
  background: "#121214",
  card: "#1e1e22",
  label: "#e6e6e9",
  subtle: "#9aa0a6",
  accent: "#9ab4ff",
  onAccent: "#0b0b0d",
  danger: "#f28b82",
  success: "#81c995",
  separator: "#33333a",
  field: "#26262b",
};

export type ThemeColors = typeof light;

export function useColors(): ThemeColors {
  return useColorScheme() === "dark" ? dark : light;
}
