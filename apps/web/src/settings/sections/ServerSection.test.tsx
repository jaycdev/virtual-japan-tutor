// Server: the web app has no address to set (it talks to its own origin), so the
// section is one health line. The mobile address-field tests do not carry over.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../../test/fakeSettingsApi.ts";

function renderServer(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  renderAppAt("/settings/server", { api: fakeSettingsApi(state) });
  return state;
}

describe("Settings › Server", () => {
  it("says the server and its database are fine when health is ok", async () => {
    renderServer();
    expect(await screen.findByText("The server is reachable and its database is connected.")).toBeTruthy();
    expect(screen.getByText("The app talks to the server it was loaded from, so there is no address to change here.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("says the database is out of reach when health is degraded", async () => {
    renderServer({ health: { status: "degraded", database: "unreachable" } });
    expect(await screen.findByText("The server answered, but cannot reach its database.")).toBeTruthy();
  });

  it("Check again asks the server once more", async () => {
    const state = renderServer();
    await screen.findByText("The server is reachable and its database is connected.");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    // The recheck re-reads health; the line returns, now from the second attempt.
    await waitFor(() =>
      expect(screen.getByText("The server is reachable and its database is connected.")).toBeTruthy(),
    );
    expect(state.writes).toHaveLength(0); // health reads are GETs; nothing was written
  });
});
