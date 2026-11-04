// The full Focus Set page behind Today's "See all" (/settings/focus). The set
// itself is written by Syncs, Stories and Practice; this page only reads it, with
// the same chip labels the glance uses.
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderFocus(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  const { router } = renderAppAt("/settings/focus", { api: fakeSettingsApi(state) });
  return { state, router };
}

describe("Settings › focus (the full Focus Set)", () => {
  it("opens from Today's deep link with the same labels as the glance", async () => {
    renderFocus({
      focusSet: {
        items: [
          { kind: "kanji", itemRef: "山", srsLevel: 2 },
          { kind: "vocabulary", itemRef: "1358280", srsLevel: 1 },
          { kind: "grammar", itemRef: "g-9", srsLevel: null },
        ],
        size: 12,
      },
      entries: { "1358280": { headword: "食べる", reading: "たべる" } },
      grammarPoints: { "g-9": "〜です" },
    });
    const list = await screen.findByRole("list", { name: "Focus Set" });
    await waitFor(() => expect(within(list).getByText("食べる (たべる)")).toBeTruthy());
    expect(within(list).getByText("山")).toBeTruthy();
    expect(within(list).getByText("〜です")).toBeTruthy();
  });

  it("keeps a vocabulary chip on its id when the entry is not in the catalogue", async () => {
    renderFocus({ focusSet: { items: [{ kind: "vocabulary", itemRef: "9999", srsLevel: null }], size: 12 } });
    const list = await screen.findByRole("list", { name: "Focus Set" });
    expect(within(list).getByText("Word 9999")).toBeTruthy();
  });

  it("says the set is still empty", async () => {
    renderFocus({ focusSet: { items: [], size: 12 } });
    expect(
      await screen.findByText("Nothing chosen yet — a Sync, a Story or a Practice session fills it in."),
    ).toBeTruthy();
  });

  it("names the page and how big the set is, without adding a hub entry", async () => {
    renderFocus();
    expect(await screen.findByRole("heading", { name: "Today’s Focus Set" })).toBeTruthy();
    expect(
      screen.getByText("These are the items your Stories and Practice are built around, up to 12 at a time."),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).queryByRole("link", { name: /Focus/ })).toBeNull();
    expect(within(nav).getAllByRole("link").length).toBe(8);
  });

  it("reports a failed load and offers a retry", async () => {
    renderFocus({ focusSet: { items: [], size: 12, fail: true } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Cannot load your Focus Set");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
