import type { StorySentence, StoryToken } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { lookupKey } from "./marks.ts";
import { useEntryLookup } from "./useEntryLookup.ts";

describe("useEntryLookup", () => {
  it("a phrase's Lookup is keyed by its empty reading, so load and peek agree on it (issue #97)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ entSeq: 1234567, found: true, headword: "がっこうで" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
    const { result } = renderHook(() => useEntryLookup(client));

    // がっこう is linked to its own entry, and a Phrase over it names entry 1234567.
    const token: StoryToken = {
      surface: "がっこう",
      start: 0,
      end: 4,
      reading: "がっこう",
      tag: "unknown",
      entSeq: 990101,
      showFurigana: false,
    };
    const sentence = {
      ja: "がっこうで",
      en: "",
      tokens: [token],
      grammarSpans: [],
      phrases: [{ start: 0, end: 5, entSeq: 1234567, ja: "がっこうで", en: "at school" }],
    } as StorySentence;
    const key = lookupKey(sentence, token, null);
    if (key === null) throw new Error("expected a phrase key");
    expect(key).toEqual({ entSeq: 1234567, surface: "がっこうで", reading: "" });

    act(() => {
      result.current.load(key.entSeq, key.surface, key.reading);
    });
    await waitFor(() => expect(result.current.peek(key.entSeq, key.surface, key.reading)).toBeDefined());
    // An omitted reading is the same cache key as the empty one the phrase uses.
    expect(result.current.peek(1234567, "がっこうで")).toBeDefined();
    // The word's own entry is a different key, so it is not loaded.
    expect(result.current.peek(990101, "がっこう", "がっこう")).toBeUndefined();
  });
});
