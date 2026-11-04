/**
 * Router integration test (#44): mounts the real Expo Router app (real
 * app/_layout.tsx + route files via ExpoRoot) on jsdom with a fake API, and
 * asserts the shell behaviour end to end — chrome per viewport, navigation
 * between destinations, the reader route hiding the tab bar, deep links,
 * and log out. Mental model: route Back is the router's (Android hardware
 * Back maps to history, and history.back() stands in for it here); the
 * useHardwareBack hook is only for in-component overlays — one test drives
 * that hook to prove the reader's route pop runs through it.
 */
import { ExpoRoot } from "expo-router";
import { expoRouterTestContext, type RouteModule } from "../test/expo-router-app-root.ts";
import { fakeBackHandler } from "../test/back-handler-fake.ts";
import * as layoutRoute from "../app/_layout.tsx";
import * as indexRoute from "../app/index.tsx";
import * as storiesRoute from "../app/stories.tsx";
import * as storyReaderRoute from "../app/stories/[id].tsx";
import * as practiceRoute from "../app/practice.tsx";
import * as grammarRoute from "../app/grammar.tsx";
import * as grammarDetailRoute from "../app/grammar/[id].tsx";
import * as settingsHomeRoute from "../app/settings/index.tsx";
import * as settingsSectionRoute from "../app/settings/[section].tsx";
import * as setupRoute from "../app/setup.tsx";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setBackHandlerForTests } from "./useHardwareBack.ts";
import { resolveApiBaseUrl } from "./config.ts";

const TEST_SERVER_URL = resolveApiBaseUrl({});

// Metro compiles expo-router's route context from an app-root glob; tests hand
// ExpoRoot the same shape over statically imported route modules (#42 spike's
// harness, extended to the #44 route tree).
const ROUTE_MODULES: Record<string, RouteModule> = {
  "./_layout": layoutRoute,
  "./index": indexRoute,
  "./stories": storiesRoute,
  "./stories/[id]": storyReaderRoute,
  "./practice": practiceRoute,
  "./grammar": grammarRoute,
  "./grammar/[id]": grammarDetailRoute,
  "./settings/index": settingsHomeRoute,
  "./settings/[section]": settingsSectionRoute,
  "./setup": setupRoute,
};

const NARROW = 900;
const WIDE = 1280;

function setViewport(width: number) {
  // The Shell measures width through react-native-web's useWindowDimensions,
  // which follows RN's Dimensions 'change' event. In jsdom that event fires
  // from window.visualViewport resize (or window resize without it), reading
  // the viewport size as it goes — so drive that path rather than Dimensions.
  Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(document.documentElement, "clientHeight", { value: 900, configurable: true });
  const vv = window.visualViewport;
  if (vv) {
    Object.defineProperty(vv, "width", { value: width, configurable: true });
    Object.defineProperty(vv, "height", { value: 900, configurable: true });
    vv.dispatchEvent(new Event("resize"));
  }
  window.dispatchEvent(new Event("resize"));
}

function storyView() {
  // Same StoryView shape as src/Stories.test.tsx's fixture — the reader
  // consumes sentences/tokens, not pages.
  return {
    id: "st-1",
    title: "がっこうの 一日",
    titleEn: "A Day at School",
    theme: "school life",
    origin: "automatic",
    genre: "diary",
    text: "がっこうでべんきょうしました。",
    createdAt: "2026-11-01T09:00:00Z",
    attempts: 1,
    sentences: [
      {
        ja: "がっこうでべんきょうしました。",
        en: "I studied at school.",
        tokens: [
          {
            surface: "がっこう",
            start: 0,
            end: 4,
            reading: "がっこう",
            dictionary: "学校",
            entSeq: 990101,
            tag: "known",
            srsLevel: 4,
            showFurigana: false,
          },
          { surface: "で", start: 4, end: 5, reading: "で", entSeq: 990102, tag: "unknown", showFurigana: false },
          { surface: "べんきょう", start: 5, end: 9, reading: "勉強", tag: "unknown", showFurigana: true },
          { surface: "しました", start: 9, end: 13, reading: "しました", tag: "unknown", showFurigana: true },
        ],
        grammarSpans: [],
      },
    ],
    questions: [],
    vocabItems: [{ entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: true }],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(options: { startingLevelConfigured?: boolean; failStartingLevelPut?: boolean } = {}): ReturnType<typeof vi.fn> {
  const levelConfigured = options.startingLevelConfigured ?? true;
  const fetchMock = vi.fn(async (input: unknown) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const path = new URL(request.url).pathname;
    if (path === "/starting-level" && request.method === "PUT" && options.failStartingLevelPut)
      return jsonResponse(400, { error: { code: "invalid_level", message: "The level is not valid." } });
    // LoginResponse carries the User too (api/openapi.yaml) — a stub without
    // it leaves useAuth signed in without a user until the /me re-check lands.
    if (path === "/auth/login")
      return jsonResponse(200, {
        token: "jwt.tok.end",
        expires_at: "2026-12-01T00:00:00Z",
        user: { userId: "u-1", username: "Learner", level: 4 },
      });
    if (path === "/me") return jsonResponse(200, { userId: "u-1", username: "Learner", level: 4 });
    if (path === "/auth/logout") return new Response(null, { status: 204 });
    if (path === "/stories/generation") return jsonResponse(200, { status: "idle", stage: null, percent: 0 });
    if (path === "/stories/suggestions")
      return jsonResponse(200, { genres: ["travel", "mystery"], themes: ["school life"] });
    if (path === "/stories/st-1/read" && request.method === "PUT") return new Response(null, { status: 204 });
    if (path === "/stories/st-1" && request.method === "GET") return jsonResponse(200, storyView());
    if (path === "/stories/today" && request.method === "GET") return jsonResponse(200, storyView());
    if (path === "/stories" && request.method === "GET")
      return jsonResponse(200, { items: [storyView()], total: 1, limit: 10, offset: 0 });
    if (path === "/reading-settings")
      return jsonResponse(200, { blurTranslation: true, lookupHoldMs: 500 });
    if (path === "/starting-level")
      return jsonResponse(200, { configured: levelConfigured, level: levelConfigured ? "N5" : null });
    if (path === "/ai-providers") return jsonResponse(200, []);
    if (path === "/ai-tasks") return jsonResponse(200, []);
    if (path === "/story-settings")
      return jsonResponse(200, { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "" });
    if (path === "/item-lists")
      return jsonResponse(200, { items: [], defaultListId: null });
    // Today (#47) reads these two; without stubs they fall into the catch-all
    // below, whose shape is not a valid payload for either.
    if (path === "/focus-set")
      return jsonResponse(200, { size: 0, items: [] });
    if (path === "/grammar/points")
      return jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 });
    if (path === "/marumori")
      return jsonResponse(200, { connected: false, lastSync: null, lastFailure: null, counts: null });
    if (path === "/health") return jsonResponse(200, { status: "ok", database: "connected" });
    return jsonResponse(200, { items: [], nextCursor: null, total: 0, updatedMs: 0 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp(path: string) {
  render(
    <ExpoRoot
      context={expoRouterTestContext(ROUTE_MODULES)}
      location={new URL(path, "http://localhost/")}
    />,
  );
}

beforeEach(() => {
  // A stored session is the signed-in starting point; the Login flow itself is
  // covered by src/Login.test.tsx. Under vitest the app's secure store is the
  // web variant (src/secureStore.ts), i.e. localStorage.
  localStorage.clear();
  localStorage.setItem("vjt.token", "preset-token");
  localStorage.setItem("vjt.serverUrl", TEST_SERVER_URL);
  // These tests are all past first run: the #50 setup flow gates on this flag
  // (its own flow is covered by the setup tests below).
  localStorage.setItem("vjt.setupSeen", "yes");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setBackHandlerForTests(undefined);
});

async function signedIn(width = NARROW) {
  setViewport(width);
  // The chrome is the signed-in signal: tabs at narrow widths, links in the
  // sidebar at wide ones.
  if (width < 1024) {
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
  } else {
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(5));
  }
  return userEvent.setup();
}

it("signed-in narrow viewport shows the tab bar with five destinations", async () => {
  stubApi();
  renderApp("/");
  const user = await signedIn();

  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
    "Today",
    "Stories",
    "Practice",
    "Grammar",
    "Settings",
  ]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");

  await user.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByText("Starting Level"); // the settings hub replaced Today

  await user.click(screen.getByRole("tab", { name: "Today" }));
  // Today is a real screen now (#47): its Story card section stands in for the
  // old placeholder as the "we are back on Today" signal.
  await screen.findByText("Today’s story");
});

it("opening a settings section pushes it and Back returns to the hub", async () => {
  stubApi();
  renderApp("/");
  const user = await signedIn();

  await user.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByText("Starting Level");

  await user.click(await screen.findByRole("button", { name: "Reading" }));
  await screen.findByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)");

  // Hardware Back equivalent: expo-router drives its stack from the history
  // that Android's Back maps to on native, so history.back() pops the section
  // onto the hub.
  window.history.back();
  await screen.findByText("Starting Level");
  expect(screen.queryByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)")).toBeNull();
});

it("an unknown settings section shows the EmptyState and its action returns to the hub", async () => {
  stubApi();
  renderApp("/settings/bogus");
  const user = await signedIn();

  await screen.findByText("That settings section doesn’t exist.");
  await user.click(await screen.findByRole("button", { name: "Back to settings" }));
  await screen.findByText("Starting Level"); // the hub, after the redirect
});

it("opening a story from the library pushes the reader route and hides the tab bar", async () => {
  stubApi();
  renderApp("/stories");
  const user = await signedIn();

  // #48: the Library lives on the Stories tab itself — no hop to it.
  await user.click(await screen.findByRole("button", { name: "Open story: がっこうの 一日" }));
  const back = await screen.findByRole("button", { name: "Back to stories" });

  // The reader owns the screen: no tab bar while a Story is open.
  await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));

  await user.click(back);
  await screen.findByTestId("filter-unread");
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
});

it("a story deep link lands directly in the reader with the tab bar hidden", async () => {
  stubApi();
  renderApp("/stories/st-1");
  setViewport(NARROW);

  await screen.findByRole("button", { name: "Back to stories" });
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
});

it("Back from a fresh-tab story deep link replaces to the Stories tab", async () => {
  stubApi();
  renderApp("/stories/st-1"); // nothing under the route: canGoBack is false
  setViewport(NARROW);
  const user = await userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Back to stories" }));
  await screen.findByTestId("filter-unread"); // /stories, no dead end
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
});

it("Back from a fresh-tab settings deep link returns to the hub", async () => {
  stubApi();
  renderApp("/settings/reading"); // deep link in a fresh tab: nothing to pop
  const user = await signedIn();

  await screen.findByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)");
  await user.click(await screen.findByRole("button", { name: "Back" }));
  await screen.findByText("Starting Level"); // the hub, not a dead end
});

it("browser Back from a tab does not walk through the visited tabs", async () => {
  stubApi();
  renderApp("/");
  const user = await signedIn();

  await user.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByText("Starting Level");
  await user.click(screen.getByRole("tab", { name: "Stories" }));
  await screen.findByTestId("filter-unread");
  await user.click(screen.getByRole("tab", { name: "Settings" }));
  await screen.findByText("Starting Level");

  // Tab taps replace, so the history never stacked them (Today → Settings is
  // the whole trail). Back must not land on Stories, the tab visited before.
  window.history.back();
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByTestId("filter-unread")).toBeNull();
  expect(screen.getByText("Starting Level")).toBeTruthy();
});

it("hardware Back inside the reader pops the route through the useHardwareBack hook", async () => {
  stubApi();
  const backHandler = fakeBackHandler();
  setBackHandlerForTests(backHandler);

  renderApp("/stories");
  const user = await signedIn();
  await user.click(await screen.findByRole("button", { name: "Open story: がっこうの 一日" }));
  await screen.findByRole("button", { name: "Back to stories" });
  await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));

  // The press runs the reader's useHardwareBack listener (the overlay hook);
  // with no lookup window or menu open its last branch calls the route's
  // onBack — router.back — so the reader really pops back to the library.
  expect(backHandler.press()).toBe(true);
  await screen.findByTestId("filter-unread");
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
});

it("a grammar deep link renders the grammar screen inside the chrome", async () => {
  stubApi();
  renderApp("/grammar");
  await signedIn();
  // The real catalogue screen (#49), not the old placeholder: its search box
  // and its empty-catalogue note (the stub serves no points).
  await screen.findByLabelText("Search grammar");
  await screen.findByText("No grammar points yet — a MaruMori sync fills this catalogue.");
});

it("wide viewport swaps the tab bar for the sidebar with the learner and Log out", async () => {
  stubApi();
  renderApp("/");
  const user = await signedIn(WIDE);

  await screen.findByText("読");
  await screen.findByText("Learner");
  expect(screen.queryAllByRole("tab")).toHaveLength(0);

  const links = screen.getAllByRole("link");
  expect(links[0].getAttribute("aria-current")).toBe("page");

  await user.click(screen.getByRole("link", { name: "Practice" }));
  await screen.findByText("Start a practice session");

  await user.click(screen.getByRole("button", { name: "Log out" }));
  await screen.findByLabelText("Username");
});

it("signed-out visitors see the login screen and no chrome", async () => {
  localStorage.clear();
  stubApi();
  setViewport(NARROW);
  renderApp("/");

  await screen.findByText("Virtual Japan Tutor");
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
});

it("a narrow section route is one column — the menu lives in the hub, not the section", async () => {
  stubApi();
  renderApp("/settings/reading"); // narrow: the hub list is not beside it
  await signedIn();

  await screen.findByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)");
  expect(screen.getByText("Reading")).toBeTruthy();
  for (const other of ["Appearance", "MaruMori", "Server"]) {
    expect(screen.queryByRole("button", { name: other })).toBeNull();
  }
});

it("wide screens show the hub and the open section side by side", async () => {
  stubApi();
  renderApp("/settings");
  const user = await signedIn(WIDE);

  // P2: the wide hub opens Appearance in the right pane instead of a
  // "pick a section" placeholder, and the Appearance row is the current one.
  await screen.findByRole("heading", { name: "Appearance" });
  await screen.findByText("Colour theme");
  expect(
    (screen.getByRole("button", { name: "Appearance" }) as HTMLElement).getAttribute("aria-current"),
  ).toBe("page");
  await screen.findByRole("button", { name: "MaruMori" });

  await user.click(screen.getByRole("button", { name: "Reading" }));
  await screen.findByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)");
  // Two panes, not a navigation: the menu stayed, the picked row is marked.
  expect(screen.getByRole("button", { name: "MaruMori" })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Reading" }) as HTMLElement).getAttribute("aria-current"),
  ).toBe("page");

  // Switching sections happens inside the page.
  await user.click(screen.getByRole("button", { name: "MaruMori" }));
  await screen.findByLabelText("MaruMori API key");
  expect(screen.queryByLabelText("Lookup hold before a Weak Signal (ms, 0–10000)")).toBeNull();
  expect(screen.getByRole("button", { name: "Reading" })).toBeTruthy();
});

describe("first-run setup (#50)", () => {
  // Fresh device: nothing in the secure store — signed-out, setup never seen.
  function freshDevice() {
    localStorage.clear();
    setViewport(NARROW);
  }

  async function logIn() {
    await screen.findByLabelText("Username");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "learner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    screen.getByRole("button", { name: "Log in" }).click();
  }

  it("the first sign-in lands in setup once — skipping it sticks across sign out and back in", async () => {
    freshDevice();
    // A brand-new account has never picked a level — that, not the missing
    // device flag, is what puts the wizard in front of it (review B2).
    stubApi({ startingLevelConfigured: false });
    renderApp("/");

    await logIn();

    // The landing route redirected to the wizard: not Today with a modal on
    // top, and not a stack pop away either.
    await screen.findByText("Step 1 of 3: Starting Level");
    await screen.findByRole("button", { name: "Save level" });

    await fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    await screen.findByText("Today’s story");

    // Sign out through the hub's account card…
    await fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await screen.findByLabelText("Username");

    // …and back in on the same device: the seen-flag survived logout, so the
    // wizard does not return.
    await logIn();
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });

  it("skipping each step walks the wizard to the end and fires no writes", async () => {
    freshDevice();
    const fetchMock = stubApi({ startingLevelConfigured: false });
    renderApp("/");

    await logIn();
    await screen.findByRole("button", { name: "Save level" }); // step 1: Starting Level

    await fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByLabelText("MaruMori API key"); // step 2: MaruMori

    await fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByRole("button", { name: "Add provider" }); // step 3: AI Providers

    await fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText("Today’s story");

    // Skipping never half-saves: the wizard issued no PUT/POST the whole way
    // (the sign-in POST itself is not the wizard's).
    const writes = fetchMock.mock.calls.filter((call) => {
      const request = call[0] instanceof Request ? call[0] : new Request(String(call[0]));
      return request.method !== "GET" && !new URL(request.url).pathname.startsWith("/auth/");
    });
    expect(writes).toHaveLength(0);
  });

  it("Next saves what the Learner entered on the step instead of discarding it", async () => {
    // Review S2: entering a level and pressing Next used to drop the pick on
    // the floor; Next now runs the step's own save first.
    freshDevice();
    const fetchMock = stubApi({ startingLevelConfigured: false });
    renderApp("/");

    await logIn();
    await screen.findByRole("button", { name: "Save level" }); // step 1: Starting Level

    await fireEvent.click(screen.getByRole("button", { name: "N4" }));
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Moved to step 2, and the pick itself went over the wire first.
    await screen.findByLabelText("MaruMori API key");
    const puts = fetchMock.mock.calls.filter((call) => {
      const request = call[0] as Request;
      return request.method === "PUT" && new URL(request.url).pathname === "/starting-level";
    });
    expect(puts).toHaveLength(1);
    expect(await (puts[0][0] as Request).json()).toEqual({ level: "N4" });
  });

  it("a blocked note belongs to the step that failed and does not follow the skip", async () => {
    // Found on the Android run: after a blocked Next, "Skip this step" carried
    // the wizard's "could not be saved" note onto the next step, accusing it
    // of a save that never happened.
    freshDevice();
    stubApi({ startingLevelConfigured: false, failStartingLevelPut: true });
    renderApp("/");

    await logIn();
    await screen.findByRole("button", { name: "Save level" }); // step 1

    await fireEvent.click(screen.getByRole("button", { name: "N4" }));
    await fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Blocked: still on step 1, with the wizard's way-out note showing.
    await screen.findByText("The step could not be saved. Fix it and try again, or skip this step.");
    expect(screen.queryByLabelText("MaruMori API key")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByLabelText("MaruMori API key"); // step 2
    expect(
      screen.queryByText("The step could not be saved. Fix it and try again, or skip this step."),
    ).toBeNull();
  });

  it("a device that has seen setup never sees it again", async () => {
    // The beforeEach already carries vjt.setupSeen = yes and a session.
    stubApi();
    renderApp("/");
    await signedIn();

    await screen.findByText("Today’s story");
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });

  it("an already-configured returning learner is not walked through setup", async () => {
    // Review B2: the app reinstalled (or a second Learner on this device, or
    // an account created before this flow existed) — the device flag is gone
    // but the account HAS chosen a level. The gate asks the server, marks
    // setup seen, and lets them land on Today.
    freshDevice();
    stubApi({ startingLevelConfigured: true });
    renderApp("/");

    await logIn();
    await screen.findByText("Today’s story");
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
    // The flag is marked, so the next launch does not even ask the server.
    expect(localStorage.getItem("vjt.setupSeen")).toBe("yes");
  });

  it("a /setup deep link after setup was seen falls through to Today", async () => {
    // Review B2: the wizard is a one-time flow, not a permanent route. The
    // beforeEach carries vjt.setupSeen = yes.
    stubApi();
    renderApp("/setup");

    await screen.findByText("Today’s story");
    expect(screen.queryByText(/Step \d of 3/)).toBeNull();
  });
});
