// Starting Level (ported from apps/mobile StartingLevelSettings.test.tsx): the
// N5–N1 picker, the Save that only unlocks with a pending pick, the seeded
// grammar counts it reports, and the read-only review list.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderLevel(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/level", { api: fakeSettingsApi(state) });
  return state;
}

describe("Settings › Starting Level", () => {
  it("shows the stored level and keeps Save level closed until a pick is pending", async () => {
    renderLevel({ level: { configured: true, level: "N4" } });
    expect(await screen.findByText("Starting level: N4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "N4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Save level" }).hasAttribute("disabled")).toBe(true);
  });

  it("says so when no level is chosen yet", async () => {
    renderLevel({ level: { configured: false, level: "" } });
    expect(await screen.findByText("Not chosen yet. Pick one to mark everything at or below it as known.")).toBeTruthy();
  });

  it("a new pick saves, and reports the Seeded Grammar counts", async () => {
    const state = renderLevel({ level: { configured: true, level: "N4" } });
    await screen.findByText("Starting level: N4");
    fireEvent.click(screen.getByRole("button", { name: "N5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save level" }));

    await waitFor(() => {
      const put = state.writes.find((w) => w.method === "PUT" && w.path === "/starting-level");
      expect(put?.body).toEqual({ level: "N5" });
    });
    expect(await screen.findByText("Grammar updated: 4 added, 1 removed.")).toBeTruthy();
  });

  it("shows an unassigned pick without saving anything", async () => {
    const state = renderLevel({ level: { configured: true, level: "N4" } });
    await screen.findByText("Starting level: N4");
    fireEvent.click(screen.getByRole("button", { name: "N2" }));
    expect(screen.getByRole("button", { name: "N2" }).getAttribute("aria-pressed")).toBe("true");
    expect(state.writes).toHaveLength(0);
  });

  it("lists the grammar points that need a second look, in the Learner's words", async () => {
    renderLevel({
      grammarReview: [
        { marumoriId: "m-1", pattern: "〜だ", jlptLevel: "N5", matchedPointId: null },
        { marumoriId: "m-2", pattern: "〜です", jlptLevel: null, matchedPointId: "p-7" },
      ],
    });
    expect(await screen.findByText("〜だ (MaruMori level N5) — no Grammar Catalogue match")).toBeTruthy();
    expect(screen.getByText("〜です — matched point p-7, level was ambiguous")).toBeTruthy();
  });

  it("says when the review list is empty", async () => {
    renderLevel({ grammarReview: [] });
    expect(await screen.findByText("Nothing needs a second look.")).toBeTruthy();
  });
});
