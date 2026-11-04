import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SETUP_SEEN_KEY } from "@vjt/core";
import { TEST_PASSWORD, TEST_USER, currentLocation, renderAppAt } from "../test/renderApp.tsx";

async function signIn(user: ReturnType<typeof userEvent.setup>, username = TEST_USER.username, password = TEST_PASSWORD) {
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("route guard", () => {
  it("sends a signed-out visitor to /login with next, then back to the page they asked for", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/stories/12?from=today", { signedIn: false });

    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
    expect(currentLocation(router)).toBe(`/login?next=${encodeURIComponent("/stories/12?from=today")}`);

    await signIn(user);

    await waitFor(() => expect(currentLocation(router)).toBe("/stories/12?from=today"));
    expect(await screen.findByRole("heading", { name: "Story" })).toBeTruthy();
  });

  it("omits next when the signed-out visitor wanted the landing page", async () => {
    const { router } = renderAppAt("/", { signedIn: false });
    await screen.findByRole("button", { name: "Log in" });
    expect(currentLocation(router)).toBe("/login");
  });

  it("never returns the Learner to an address off this site, even when next asks for one", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/login?next=%2F%2Fevil.example.com", { signedIn: false });
    await screen.findByRole("button", { name: "Log in" });

    await signIn(user);

    await waitFor(() => expect(currentLocation(router)).toBe("/"));
  });

  it("sends a new Learner from the landing page to first-run setup, and marks the flag once shown", async () => {
    const { router } = renderAppAt("/", { startingLevelConfigured: false });

    await waitFor(() => expect(currentLocation(router)).toBe("/setup"));
    expect(await screen.findByRole("heading", { name: "Set up" })).toBeTruthy();
    expect(window.localStorage.getItem(SETUP_SEEN_KEY)).toBe("yes");
  });

  it("leaves a Learner with a Starting Level on Today", async () => {
    const { router } = renderAppAt("/", { startingLevelConfigured: true });

    await waitFor(() => expect(window.localStorage.getItem(SETUP_SEEN_KEY)).toBe("yes"));
    expect(currentLocation(router)).toBe("/");
  });

  it("returns a Learner who has already seen setup to Today, even on a deep link to /setup", async () => {
    window.localStorage.setItem(SETUP_SEEN_KEY, "yes");
    const { router } = renderAppAt("/setup", { startingLevelConfigured: false });

    await waitFor(() => expect(currentLocation(router)).toBe("/"));
    expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull();
  });

  it("signs out to /login with no next, even when the Learner was on a deep page", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/grammar/n3-te-form");
    expect(await screen.findByRole("heading", { name: "Grammar point" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(currentLocation(router)).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
  });
});
