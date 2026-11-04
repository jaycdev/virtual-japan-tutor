import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SETUP_SEEN_KEY } from "@vjt/core";
import { TEST_PASSWORD, TEST_USER, currentLocation, renderAppAt } from "../test/renderApp.tsx";
import { LANDING_CHECK_TIMEOUT_MS } from "./RequireSession.tsx";

/** A GET /starting-level answer the test resolves by hand, once the request has been made. */
function heldReply() {
  let resolve!: (response: Response) => void;
  let requested!: () => void;
  const requestedSeen = new Promise<void>((r) => {
    requested = r;
  });
  const reply = () =>
    new Promise<Response>((r) => {
      resolve = r;
      requested();
    });
  return {
    reply,
    answer: async (body: unknown) => {
      await requestedSeen;
      await act(async () => resolve(Response.json(body)));
    },
  };
}

/** The landing gate's own skeleton (the route-level fallback is a different element). */
const isGateHolding = () => document.querySelector('[data-gate="first-run"]') !== null;

/** Resolves once the route has mounted the gate and it is holding the page. */
async function waitForGate(): Promise<boolean> {
  return waitFor(() => {
    if (!isGateHolding()) throw new Error("the first-run gate is not holding yet");
    return true;
  });
}

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
    // The Story route is the reader now (#77). This harness has no Story 12, so the
    // reader's own error state with Retry is what the Learner lands on.
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
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

  it("remembers next again on a later signed-out visit, after a logout", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/stories");
    await screen.findByRole("heading", { name: "Stories" });

    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/login"));

    await act(() => router.navigate("/stories/5"));

    await waitFor(() => expect(currentLocation(router)).toBe("/login?next=%2Fstories%2F5"));
  });

  it("holds the landing page behind a skeleton until the first-run check answers", async () => {
    const held = heldReply();
    const { router } = renderAppAt("/", { startingLevelReply: held.reply });

    expect(await waitForGate()).toBe(true);
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();

    await held.answer({ id: TEST_USER.id, username: TEST_USER.username, configured: true });

    expect(await screen.findByRole("heading", { name: "Today" })).toBeTruthy();
    expect(isGateHolding()).toBe(false);
    expect(currentLocation(router)).toBe("/");
  });

  it("never renders Today for a Learner who goes to /setup, even after the answer", async () => {
    const held = heldReply();
    const { router } = renderAppAt("/", { startingLevelReply: held.reply });
    expect(await waitForGate()).toBe(true);
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();

    await held.answer({ id: TEST_USER.id, username: TEST_USER.username, configured: false });

    await waitFor(() => expect(currentLocation(router)).toBe("/setup"));
    expect(await screen.findByRole("heading", { name: "Set up" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();
  });

  it("shows the landing page when the first-run check fails", async () => {
    const { router } = renderAppAt("/", {
      startingLevelReply: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    expect(await screen.findByRole("heading", { name: "Today" })).toBeTruthy();
    expect(currentLocation(router)).toBe("/");
  });

  it("shows the landing page after the check times out instead of holding the Learner", async () => {
    vi.useFakeTimers();
    try {
      renderAppAt("/", { startingLevelReply: () => new Promise<Response>(() => undefined) });
      // The route mounts the gate after its lazy module resolves; let that happen first,
      // so the gate's timer is scheduled on the fake clock.
      for (let i = 0; i < 20 && !isGateHolding(); i++) {
        await act(async () => undefined);
      }
      expect(isGateHolding()).toBe(true);
      expect(screen.queryByRole("heading", { name: "Today" })).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(LANDING_CHECK_TIMEOUT_MS);
      });

      expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
