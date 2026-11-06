// The React glue (issue #125): a provider hands the apps' stored choice to
// every core hook, and without one everything reads "en" — which is how the
// apps keep rendering today's English until Parts 2/3 wrap them.

import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  InterfaceLanguageProvider,
  useInterfaceLanguage,
  useT,
} from "./context.ts";
import type { InterfaceLanguage } from "./language.ts";

function wrapper(language: InterfaceLanguage, setLanguage: (lang: InterfaceLanguage) => void) {
  return ({ children }: { children?: ReactNode }) =>
    createElement(InterfaceLanguageProvider, { language, setLanguage }, children);
}

describe("useInterfaceLanguage", () => {
  it("reads the default English when no provider wraps the tree", () => {
    const { result } = renderHook(() => useInterfaceLanguage());
    expect(result.current.language).toBe("en");
    expect(result.current.options.map((o) => o.value)).toEqual(["en", "ja", "ja-furigana"]);
    // The no-provider setter is a no-op rather than a crash.
    expect(() => result.current.setLanguage("ja")).not.toThrow();
  });

  it("hands the app's language and setter straight down", () => {
    const setLanguage = vi.fn();
    const { result } = renderHook(() => useInterfaceLanguage(), {
      wrapper: wrapper("ja-furigana", setLanguage),
    });
    expect(result.current.language).toBe("ja-furigana");
    result.current.setLanguage("en");
    expect(setLanguage).toHaveBeenCalledWith("en");
  });
});

describe("useT", () => {
  it("translates in the provider's language", () => {
    const { result } = renderHook(() => useT(), { wrapper: wrapper("ja", () => undefined) });
    expect(result.current.tp("errors.not_found")).toBe("見つかりませんでした");
    expect(result.current.t("errors.not_found").every((s) => s.ruby === undefined)).toBe(true);
  });

  it("carries readings for a furigana UI and params everywhere", () => {
    const { result } = renderHook(() => useT(), { wrapper: wrapper("ja-furigana", () => undefined) });
    expect(result.current.t("errors.not_found")).toEqual([
      { text: "見", ruby: "み" },
      { text: "つかりませんでした" },
    ]);
    expect(result.current.tp("errors.failedStatus", { status: 503 })).toBe("リクエストに失敗しました（503）");
  });

  it("stays in English with no provider at all", () => {
    const { result } = renderHook(() => useT());
    expect(result.current.language).toBe("en");
    expect(result.current.tp("errors.failedStatus", { status: 503 })).toBe("Request failed (503)");
  });
});
