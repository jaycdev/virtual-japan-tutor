import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useFocusSet } from "./useFocusSet.ts";
import { InterfaceLanguageProvider } from "./i18n/context.ts";
import type { InterfaceLanguage } from "./i18n/language.ts";

function fakeClient() {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return { client, fetchImpl, json };
}

/**
 * Renders the hook under an Interface Language the test can switch after
 * mount: the wrapper owns the provider state (renderHook's `wrapper` takes
 * only children; its props never reach it).
 */
function languageHarness() {
  let change: (language: InterfaceLanguage) => void = () => undefined;
  function LanguageWrapper({ children }: { children: ReactNode }) {
    const [language, setLanguage] = useState<InterfaceLanguage>("en");
    change = setLanguage;
    return createElement(InterfaceLanguageProvider, { language, setLanguage: () => undefined, children });
  }
  return {
    wrapper: LanguageWrapper,
    switchLanguage: (language: InterfaceLanguage) => act(() => change(language)),
  };
}

const SET = {
  size: 15,
  items: [
    { kind: "kanji", itemRef: "学", source: "marumori", mastery: 0.3, srsLevel: 2, newlyObservedGrammar: false },
    { kind: "grammar", itemRef: "42", source: "seeded", mastery: 0.1, srsLevel: null, newlyObservedGrammar: true },
  ],
};

describe("useFocusSet", () => {
  it("loads the set on mount", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementationOnce(async () => json(200, SET));
    const { result } = renderHook(() => useFocusSet(client));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.size).toBe(15);
    expect(result.current.items?.map((item) => item.itemRef)).toEqual(["学", "42"]);
    const call = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(call.url).toContain("/focus-set");
  });

  it("keeps a failed read as a retryable error rather than throwing", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementationOnce(async () => json(500, { message: "boom" }));
    const { result } = renderHook(() => useFocusSet(client));

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.items).toBeNull();

    fetchImpl.mockImplementationOnce(async () => json(200, SET));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });

  it("reports an unreachable server in the same slot", async () => {
    const { client, fetchImpl } = fakeClient();
    fetchImpl.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });
    const { result } = renderHook(() => useFocusSet(client));

    await waitFor(() => expect(result.current.error).toBe("Cannot reach the server"));
  });

  it("re-labels a failed read in the new language without refetching (B1)", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementation(async () => json(500, { code: "internal", message: "Internal server error" }));
    const { wrapper, switchLanguage } = languageHarness();
    const { result } = renderHook(() => useFocusSet(client), { wrapper });

    await waitFor(() => expect(result.current.error).toBe("Internal server error"));
    expect(result.current.loading).toBe(false);

    // The held failure is English-neutral: switching languages re-renders the
    // same error in Japanese — no second GET, no flip back to `loading`.
    switchLanguage("ja");
    expect(result.current.error).toBe("サーバー側で問題が起きました");
    expect(result.current.loading).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    switchLanguage("en");
    expect(result.current.error).toBe("Internal server error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
