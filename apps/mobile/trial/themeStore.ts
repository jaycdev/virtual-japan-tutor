import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { ThemeName } from "uniwind";

// #42 spike: where the theme choice lives per device (ADR-0008: Uniwind does
// not persist it). localStorage on web, secure store on Android. Formalised
// by #43.
// Uniwind's ThemeName is the union of configured themes ('light' | 'dark');
// Uniwind.setTheme additionally accepts its internal 'system' sentinel, which
// is not part of ThemeName, so the app-level choice adds it explicitly.
export type ThemeChoice = ThemeName | "system";

export const THEME_KEY = "vjt.trial.theme";

const CHOICES: ThemeChoice[] = ["light", "dark", "system"];

function isChoice(value: string | null): value is ThemeChoice {
  return value !== null && (CHOICES as string[]).includes(value);
}

export async function loadThemeChoice(): Promise<ThemeChoice | null> {
  let raw: string | null;
  if (Platform.OS === "web") {
    raw = globalThis.localStorage?.getItem(THEME_KEY) ?? null;
  } else {
    raw = await SecureStore.getItemAsync(THEME_KEY);
  }
  return isChoice(raw) ? raw : null;
}

export async function saveThemeChoice(choice: ThemeChoice): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(THEME_KEY, choice);
  } else {
    await SecureStore.setItemAsync(THEME_KEY, choice);
  }
}
