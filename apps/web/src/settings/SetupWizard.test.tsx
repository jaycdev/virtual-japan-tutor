// The first-run wizard (ported from the mobile setup wizard tests): three steps,
// each embedding the real Settings section; Next saves what the step registered,
// a blocked save keeps the Learner on the step with a way out, and every skip
// button moves on without writing.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { currentLocation, renderAppAt } from "../test/renderApp.tsx";
import { fakeSettingsApi, freshState, type FakeState } from "../test/fakeSettingsApi.ts";

function renderSetup(overrides: Partial<FakeState> = {}) {
  const state = freshState(overrides);
  const { router } = renderAppAt("/setup", { api: fakeSettingsApi(state) });
  return { state, router };
}

async function stepOne() {
  return screen.findByRole("heading", { name: "Set up" });
}

describe("Setup wizard", () => {
  it("opens on the Starting Level step with the progress named", async () => {
    renderSetup();
    await stepOne();
    expect(await screen.findByRole("progressbar", { name: "Step 1 of 3: Starting Level" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Setup steps" })).toBeTruthy();
    expect(screen.getByText("Starting level: N4")).toBeTruthy();
  });

  it("Next saves the pick, moves to MaruMori, and Finish leaves for Today", async () => {
    const { state, router } = renderSetup();
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "N3" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      const put = state.writes.find((w) => w.path === "/starting-level" && w.method === "PUT");
      expect(put?.body).toEqual({ level: "N3" });
    });
    expect(await screen.findByRole("progressbar", { name: "Step 2 of 3: MaruMori" })).toBeTruthy();
    expect(screen.getByText("Not connected.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" })); // no key typed: nothing to save
    expect(await screen.findByRole("progressbar", { name: "Step 3 of 3: AI Providers" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/"));
  });

  it("a blocked save keeps the Learner on the step and says what they can do", async () => {
    const state = renderSetup();
    state.failNext["PUT /starting-level"] = "The level is unknown.";
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "N1" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(
      await screen.findByText("The step could not be saved. Fix it and try again, or skip this step."),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Step 1 of 3: Starting Level" })).toBeTruthy();
    expect(screen.getByText("The level is unknown.")).toBeTruthy();
  });

  it("Skip this step moves on without writing anything", async () => {
    const state = renderSetup();
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "N1" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));

    expect(await screen.findByRole("progressbar", { name: "Step 2 of 3: MaruMori" })).toBeTruthy();
    expect(state.writes.filter((w) => w.path === "/starting-level")).toHaveLength(0);
  });

  it("the MaruMori step saves a typed key through Next", async () => {
    const state = renderSetup();
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByText("Not connected.");
    fireEvent.change(screen.getByLabelText("MaruMori API key"), { target: { value: "kk" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(state.writes.some((w) => w.method === "PUT" && w.path === "/marumori/key")).toBe(true);
    });
    expect(await screen.findByRole("progressbar", { name: "Step 3 of 3: AI Providers" })).toBeTruthy();
  });

  it("Skip setup leaves the whole flow from any step", async () => {
    const { router, state } = renderSetup();
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByText("Not connected.");
    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/"));
    expect(state.writes).toHaveLength(0);
  });

  it("the last step offers Finish, not Skip this step", async () => {
    renderSetup();
    await stepOne();
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByText("Not connected.");
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByText("No providers yet. Add an OpenAI-compatible endpoint below.");
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip this step" })).toBeNull();
  });
});
