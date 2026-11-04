// Reading (ported from apps/mobile ReadingSettingsSection.test.tsx): the two
// controls and what they send. The section is mounted through the real route so
// the labels, the switch role and the announced save all travel with it.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderReading(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/reading", { api: fakeSettingsApi(state) });
  return state;
}

const HOLD_LABEL = "Lookup hold before a Weak Signal (ms, 0–10000)";

describe("Settings › Reading", () => {
  it("prefills the stored settings", async () => {
    renderReading({ reading: { blurTranslation: true, lookupHoldMs: 350 } });
    const blur = await screen.findByRole("switch", { name: "Blur the translation behind Weak Signals" });
    expect((blur as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(HOLD_LABEL) as HTMLInputElement).value).toBe("350");
  });

  it("saves the blur switch on its own, and announces it", async () => {
    const state = renderReading({ reading: { blurTranslation: true, lookupHoldMs: 800 } });
    const blur = await screen.findByRole("switch", { name: "Blur the translation behind Weak Signals" });
    await userEvent.click(blur);

    await waitFor(() => {
      const put = state.writes.find((w) => w.path === "/reading-settings");
      expect(put?.method).toBe("PUT");
      expect(put?.body).toEqual({ blurTranslation: false, lookupHoldMs: 800 });
    });
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("rejects a hold that is not a whole number of milliseconds", async () => {
    const state = renderReading();
    await screen.findByRole("switch", { name: "Blur the translation behind Weak Signals" });
    fireEvent.change(screen.getByLabelText(HOLD_LABEL), { target: { value: "12.5" } });

    expect(await screen.findByText("The hold is a whole number of milliseconds from 0 to 10000.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save reading settings" }).hasAttribute("disabled")).toBe(true);
    expect(state.writes.find((w) => w.path === "/reading-settings")).toBeUndefined();
  });

  it("saves a new hold, and the field goes back to the stored value", async () => {
    const state = renderReading({ reading: { blurTranslation: false, lookupHoldMs: 800 } });
    await screen.findByRole("switch", { name: "Blur the translation behind Weak Signals" });
    fireEvent.change(screen.getByLabelText(HOLD_LABEL), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reading settings" }));

    await waitFor(() => {
      const put = state.writes.find((w) => w.path === "/reading-settings");
      expect(put?.body).toEqual({ blurTranslation: false, lookupHoldMs: 250 });
    });
    expect(await screen.findByText("Saved. The reader uses this from the next lookup on.")).toBeTruthy();
    expect((screen.getByLabelText(HOLD_LABEL) as HTMLInputElement).value).toBe("250");
  });

  it("shows the server's message when the save fails", async () => {
    const state = renderReading();
    state.failNext["PUT /reading-settings"] = "The hold must be 0 or more.";
    await screen.findByRole("switch", { name: "Blur the translation behind Weak Signals" });
    await userEvent.click(screen.getByRole("switch", { name: "Blur the translation behind Weak Signals" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The hold must be 0 or more.");
  });
});
