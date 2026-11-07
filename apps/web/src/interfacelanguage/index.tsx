import { useSyncExternalStore, type ReactNode } from "react";
import { InterfaceLanguageProvider, isJapanese, type InterfaceLanguage } from "@vjt/core";

import { localKeyValueStore } from "../storage.ts";
import { createInterfaceLanguageStore } from "./store.ts";

/** Publishes the choice on `<html lang>`: the page's chrome is Japanese or English. */
export function applyInterfaceLanguageToDocument(language: InterfaceLanguage): void {
  document.documentElement.lang = isJapanese(language) ? "ja" : "en";
}

export const interfaceLanguageStore = createInterfaceLanguageStore(
  localKeyValueStore,
  applyInterfaceLanguageToDocument,
);

/** The stored choice and the setter; @vjt/core owns the option list and the parsing. */
export function useInterfaceLanguageChoice(): {
  language: InterfaceLanguage;
  setLanguage: (language: InterfaceLanguage) => void;
} {
  const state = useSyncExternalStore(interfaceLanguageStore.subscribe, interfaceLanguageStore.getSnapshot);
  return { language: state.language, setLanguage: interfaceLanguageStore.setLanguage };
}

/**
 * Bridges the device's stored choice into @vjt/core's InterfaceLanguageProvider,
 * so every core sentence — and every `t()` in this app — speaks it. It sits above
 * the router in main.tsx and in the test harness, which keeps the login page and
 * the setup wizard inside the language as well.
 */
export function InterfaceLanguageGate({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useInterfaceLanguageChoice();
  return (
    <InterfaceLanguageProvider language={language} setLanguage={setLanguage}>
      {children}
    </InterfaceLanguageProvider>
  );
}
