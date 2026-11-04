// The web Today page (plan 4.4, issue #79), rendered against the stateful fake
// API. Behaviour is ported from the mobile Today suite: the greeting in the
// Learner's Timezone, the pinned Story card's states (including the run's
// progress, the re-read on finish and the failed read's Retry), the Focus
// glance, the Practice count and the Last sync line.
import { MemoryRouter } from "react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi, makeStory } from "@/test/fakeApi";
import type { FakeApi } from "@/test/fakeApi";
import { currentLocation, renderAppAt } from "@/test/renderApp";
import { Today } from "./Today.tsx";

const syncedCounts = {
  kanji: 40,
  vocabulary: 120,
  grammarReviews: 0,
  grammarLessons: 0,
  linked: 2,
  unlinked: 0,
  ambiguous: 0,
  new: 3,
  levelChanges: 1,
  disappeared: 0,
  skippedLevelZero: 0,
};

function renderToday(api: FakeApi) {
  render(
    <MemoryRouter>
      <Today client={api.client} />
    </MemoryRouter>,
  );
  return api;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Today page", () => {
  it("greets and dates in the Learner's Timezone, not the device's", async () => {
    // The clock pinned like the mobile suite pins it: 22:30 UTC on Nov 4 is
    // 07:30 the next morning in Asia/Tokyo (the fake's default Timezone), so
    // the exact greeting and date are fixed, not one of four branches.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T22:30:00Z"));
    renderToday(fakeApi());
    expect(await screen.findByRole("heading", { name: "Good morning" })).toBeTruthy();
    expect(screen.getByText("Thursday, November 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today’s Story" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Practice" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Focus Set" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Last sync" })).toBeTruthy();
    // With no Automatic Story yet the pinned card speaks the daily-writing empty state.
    expect(await screen.findByText(/the tutor writes one for you every day/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Generate a Story" }).getAttribute("href")).toBe("/stories");
  });

  it("shows Today's Story with its title, Open link and still-unread day", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const api = fakeApi({ today: makeStory("t1", { title: "猫の日", createdAt: twoDaysAgo }) });
    renderToday(api);
    expect(await screen.findByText("猫の日")).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Open today/ })).toBeTruthy();
    expect((await screen.findByRole("link", { name: /Open today/ })).getAttribute("href")).toBe("/stories/t1");
    expect(await screen.findByText(/^Still unread from/)).toBeTruthy();
  });

  it("shows the run's stage and percent while a Story is being written", async () => {
    const api = fakeApi({
      today: null,
      generation: {
        status: "running",
        stage: "writing",
        attempt: 2,
        maxAttempts: 3,
        percent: 60,
        startedAt: "2026-11-04T02:00:00Z",
      },
    });
    renderToday(api);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(await screen.findByText("Writing… attempt 2 of 3 60%")).toBeTruthy();
    // A run in flight is not an empty state: no "Generate a Story" invitation.
    expect(screen.queryByRole("link", { name: "Generate a Story" })).toBeNull();
  });

  it("re-reads Today's Story when a run finishes on screen", async () => {
    // Mobile's shape: a run is live on mount and lands while the Learner
    // watches. The web Today hook polls at the default 1500 ms, so the finish
    // arrives a beat after the test flips the snapshot.
    const api = fakeApi({
      today: makeStory("t9", { title: "雨の日の駅" }),
      generation: { status: "running", stage: "writing", percent: 40, startedAt: "2026-11-04T02:00:00Z" },
    });
    renderToday(api);
    expect(await screen.findByText("Writing… 40%")).toBeTruthy();

    api.setGeneration({ status: "ready", percent: 100, storyId: "t9" });
    await waitFor(
      () => {
        expect(api.calls.filter((c) => c.method === "GET" && c.path === "/stories/today").length).toBe(2);
      },
      { timeout: 3000 },
    );
    expect(await screen.findByText("雨の日の駅")).toBeTruthy();
    // Exactly the mount read and the finish-triggered one: a ready snapshot
    // alone must not make the page ask again (mobile's Today suite, N3).
    expect(api.calls.filter((c) => c.method === "GET" && c.path === "/stories/today")).toHaveLength(2);
  });

  it("retries a failed Today's Story in place", async () => {
    const api = fakeApi({ today: "error" });
    renderToday(api);
    expect(await screen.findByText(/Cannot load today’s Story/)).toBeTruthy();
    const before = api.calls.filter((c) => c.path === "/stories/today").length;
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === "/stories/today").length).toBeGreaterThan(before),
    );
  });

  it("counts the Focus Set toward Practice and links to the session", async () => {
    const api = fakeApi({
      focus: {
        size: 15,
        items: [
          { kind: "vocabulary", itemRef: "60006", source: "marumori", mastery: 0.4, newlyObservedGrammar: false },
          { kind: "grammar", itemRef: "gp-7", source: "seeded", mastery: 0.1, newlyObservedGrammar: false },
        ],
      },
    });
    renderToday(api);
    expect(await screen.findByText("2 Focus Set items waiting.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start practice" }).getAttribute("href")).toBe("/practice");
  });

  it("says so when the Focus Set cannot be read, and retries it", async () => {
    // Mobile's phrasing, web's parts: the Practice card speaks the failure with
    // one Retry (the glance next door keeps to a quiet line).
    const api = fakeApi({ failFocus: true });
    renderToday(api);
    expect(await screen.findByText("focus read failed")).toBeTruthy();
    expect(await screen.findByText("Your Focus Set could not be read.")).toBeTruthy();

    api.failFocus = false;
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Nothing is waiting in your Focus Set yet.")).toBeTruthy();
  });

  it("labels the focus chips through the dictionary and the Grammar Catalogue", async () => {
    const api = fakeApi({
      focus: {
        size: 15,
        items: [
          { kind: "vocabulary", itemRef: "60006", source: "marumori", mastery: 0.4, newlyObservedGrammar: false },
          { kind: "grammar", itemRef: "gp-7", source: "seeded", mastery: 0.1, newlyObservedGrammar: false },
        ],
      },
      vocabulary: { "60006": { headword: "学校", reading: "がっこう" } },
      grammar: { "gp-7": { pattern: "〜ます" } },
    });
    renderToday(api);
    const chips = await screen.findByRole("list", { name: "Focus Set at a glance" });
    expect(await within(chips).findByText("学校 (がっこう)")).toBeTruthy();
    expect(await within(chips).findByText("〜ます")).toBeTruthy();
    expect(chips.querySelectorAll("li")).toHaveLength(2);
  });

  it("says so when no MaruMori account is linked", async () => {
    renderToday(fakeApi());
    const card = await screen.findByText(/No MaruMori account linked yet/);
    expect(card).toBeTruthy();
    expect(screen.getByRole("link", { name: "Link MaruMori" }).getAttribute("href")).toBe("/settings/marumori");
  });

  it("reports the last successful sync and runs Sync now on demand", async () => {
    const api = fakeApi({
      marumori: {
        connected: true,
        lastSync: { id: "s1", status: "ok", startedAt: "2026-11-04T09:59:00Z", finishedAt: "2026-11-04T10:00:00Z", counts: syncedCounts },
        lastFailure: null,
      },
    });
    renderToday(api);
    expect(await screen.findByText(/^Last sync succeeded/)).toBeTruthy();
    expect(screen.getByText("3 new items, 1 level change, 2 linked to reference data.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/marumori/sync")).toBe(true));
    expect((await screen.findByRole("status")).textContent).toContain("Sync succeeded.");
  });

  it("reports the failure when the failed run is the newest news", async () => {
    const api = fakeApi({
      marumori: {
        connected: true,
        lastSync: { id: "s1", status: "ok", startedAt: "2026-11-01T09:00:00Z", finishedAt: "2026-11-01T09:01:00Z", counts: syncedCounts },
        lastFailure: { id: "f1", status: "failed", startedAt: "2026-11-04T09:00:00Z", finishedAt: "2026-11-04T09:02:00Z", error: "MaruMori is unreachable." },
      },
    });
    renderToday(api);
    expect(await screen.findByText(/^Last sync failed/)).toBeTruthy();
    expect(screen.getByText("MaruMori is unreachable.")).toBeTruthy();
  });

  it("the route wires the page to the session's client", async () => {
    const api = fakeApi();
    renderAppAt("/", { fetchOverride: api.fetch });
    expect(await screen.findByText(/the tutor writes one for you every day/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Last sync" })).toBeTruthy();
  });

  it("the Practice card links to the practice screen", async () => {
    const api = fakeApi();
    const { router } = renderAppAt("/", { fetchOverride: api.fetch });
    const card = await screen.findByTestId("today-practice-card");
    // findBy, not get: the card renders as an aria-busy skeleton while the
    // Focus Set read is in flight, and the link only arrives with its answer.
    const link = await within(card).findByRole("link", { name: "Start practice" });
    await userEvent.click(link);
    await waitFor(() => expect(currentLocation(router)).toBe("/practice"));
  });
});
