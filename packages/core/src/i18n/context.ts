// The React half of the Interface Language: a context carrying the Learner's
// choice down to every core sentence. Where the language is STORED is the
// apps' business (web has no stored preference yet, mobile reads AsyncStorage)
// — the provider takes language and setLanguage as props and owns no storage.
//
// Without a provider everything reads the default, "en": the apps render
// exactly what they render today until they opt in (issue #125 Parts 2/3).

import { createContext, createElement, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  interfaceLanguageOptions,
  type InterfaceLanguage,
  type InterfaceLanguageOption,
} from "./language.ts";
import type { RubyText } from "./ruby.ts";
import type { StringKey } from "./strings.ts";
import { translate, translatePlain, type TranslateParams } from "./translate.ts";

export interface InterfaceLanguageContextValue {
  language: InterfaceLanguage;
  setLanguage(language: InterfaceLanguage): void;
}

const InterfaceLanguageContext = createContext<InterfaceLanguageContextValue>({
  language: DEFAULT_INTERFACE_LANGUAGE,
  setLanguage: () => undefined,
});

export interface InterfaceLanguageProviderProps {
  language: InterfaceLanguage;
  /** The app persists the choice wherever it likes; the provider just passes it on. */
  setLanguage(language: InterfaceLanguage): void;
  children?: ReactNode;
}

export function InterfaceLanguageProvider(props: InterfaceLanguageProviderProps): ReactElement {
  const value = useMemo<InterfaceLanguageContextValue>(
    () => ({ language: props.language, setLanguage: props.setLanguage }),
    [props.language, props.setLanguage],
  );
  return createElement(InterfaceLanguageContext.Provider, { value }, props.children);
}

export interface InterfaceLanguageView {
  language: InterfaceLanguage;
  setLanguage(language: InterfaceLanguage): void;
  /** The picker's options, in order, each labelled in its own language. */
  options: readonly InterfaceLanguageOption[];
}

/** The setting and its picker data; the default ("en") when no provider wraps the tree. */
export function useInterfaceLanguage(): InterfaceLanguageView {
  const { language, setLanguage } = useContext(InterfaceLanguageContext);
  return { language, setLanguage, options: interfaceLanguageOptions };
}

export interface Translator {
  /** The current language, for handing to functions that take one. */
  language: InterfaceLanguage;
  /** One table entry as base/reading segments (`ja-furigana` carries readings). */
  t(key: StringKey, params?: TranslateParams): RubyText;
  /** One table entry as a plain string. */
  tp(key: StringKey, params?: TranslateParams): string;
}

/** Sentences in the current Interface Language, wherever a component sits. */
export function useT(): Translator {
  const { language } = useInterfaceLanguage();
  return useMemo<Translator>(
    () => ({
      language,
      t: (key, params) => translate(language, key, params),
      tp: (key, params) => translatePlain(language, key, params),
    }),
    [language],
  );
}

export { InterfaceLanguageContext };
