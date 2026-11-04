// MaruMori (ported from apps/mobile MaruMoriSettings.test.tsx): connect with a
// key, the write-only key display, Sync now and its counts line, the recent
// Syncs list, and removing the key behind a confirmation.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderMaruMori(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/marumori", { api: fakeSettingsApi(state) });
  return state;
}

const CONNECTED = {
  connected: true,
  counts: { kanji: 12, vocabulary: 300, vocabularyLinkRate: 0.534, lastSyncAt: "2026-11-01T08:00:00Z" },
};

describe("Settings › MaruMori", () => {
  it("says Not connected and offers only the key form", async () => {
    renderMaruMori();
    expect(await screen.findByText("Not connected.")).toBeTruthy();
    expect(screen.getByLabelText("MaruMori API key")).toBeTruthy();
    expect((screen.getByLabelText("MaruMori API key") as HTMLInputElement).type).toBe("password");
    expect(screen.getByRole("button", { name: "Save key" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("connects with a typed key and shows the connected state", async () => {
    const state = renderMaruMori();
    await screen.findByText("Not connected.");
    fireEvent.change(screen.getByLabelText("MaruMori API key"), { target: { value: " secret-key " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => {
      const put = state.writes.find((w) => w.method === "PUT" && w.path === "/marumori/key");
      expect(put?.body).toEqual({ apiKey: "secret-key" });
    });
    expect((await screen.findAllByText("Connected to MaruMori.")).length).toBe(2);
    expect(screen.queryByLabelText("MaruMori API key")).toBeNull();
  });

  it("shows the saved key as set, never in a field, and Replace opens a fresh one", async () => {
    renderMaruMori({ marumori: CONNECTED });
    expect(await screen.findByText("Connected to MaruMori.")).toBeTruthy();
    expect(screen.getByText("Known kanji: 12 · Known vocabulary: 300 · Vocabulary linked: 53%")).toBeTruthy();
    expect(screen.getByText("set")).toBeTruthy();
    expect(screen.queryByLabelText("MaruMori API key")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("MaruMori API key") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText("Paste a new key to replace the saved one. The saved key is never shown.")).toBeTruthy();
  });

  it("Sync now runs a Sync and reports what it changed", async () => {
    const state = renderMaruMori({ marumori: CONNECTED });
    await screen.findByText("Connected to MaruMori.");
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "POST" && w.path === "/marumori/sync")).toBe(true);
    });
    expect(await screen.findByText("Sync complete — 3 new Known Items, 1 level changes, 0 disappeared")).toBeTruthy();
  });

  it("the recent Syncs list says when there are none", async () => {
    renderMaruMori({ marumori: CONNECTED });
    await screen.findByText("Connected to MaruMori.");
    fireEvent.click(screen.getByRole("button", { name: "Show recent Syncs" }));
    expect(await screen.findByText("No Syncs yet.")).toBeTruthy();
  });

  it("removes the key behind a confirmation, and drops back to Not connected", async () => {
    const state = renderMaruMori({ marumori: CONNECTED });
    await screen.findByText("Connected to MaruMori.");
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "DELETE" && w.path === "/marumori/key")).toBe(true);
    });
    expect(await screen.findByText("Not connected.")).toBeTruthy();
    const saved = await screen.findByText("The MaruMori key was removed.");
    expect(saved.getAttribute("role")).toBe("status");
  });
});
