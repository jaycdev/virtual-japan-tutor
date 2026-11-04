// /setup's own contract (issue #50): the first Learner to land sees the wizard
// and the visit is marked, so a second visit — or any later one — goes back to
// Today without a second setup.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SETUP_SEEN_KEY } from "@vjt/core";

import { currentLocation, renderAppAt } from "../test/renderApp.tsx";
import { fakeSettingsApi, freshState } from "../test/fakeSettingsApi.ts";

describe("/setup", () => {
  it("shows the wizard the first time and marks the visit", async () => {
    const { router } = renderAppAt("/setup", { api: fakeSettingsApi(freshState()) });
    expect(await screen.findByRole("heading", { name: "Set up" })).toBeTruthy();
    expect(window.localStorage.getItem(SETUP_SEEN_KEY)).toBeTruthy();
    expect(currentLocation(router)).toBe("/setup");
  });

  it("sends a Learner who has already seen it back to Today", async () => {
    window.localStorage.setItem(SETUP_SEEN_KEY, "yes");
    const { router } = renderAppAt("/setup", { api: fakeSettingsApi(freshState()) });
    await waitFor(() => expect(currentLocation(router)).toBe("/"));
    expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull();
  });

  it("marks the visit as seen and leaves for Today when the Learner skips halfway", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/setup", { api: fakeSettingsApi(freshState()) });
    await screen.findByRole("heading", { name: "Set up" });
    await user.click(screen.getByRole("button", { name: "Skip setup" }));

    // Leaving mid-wizard still counts as seen, and the Learner lands on Today.
    await waitFor(() => expect(currentLocation(router)).toBe("/"));
    expect(window.localStorage.getItem(SETUP_SEEN_KEY)).toBeTruthy();
  });
});
