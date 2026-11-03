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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const path = new URL(request.url).pathname;
    if (path === "/auth/login") return jsonResponse(200, { token: "jwt.tok.end" });
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
    if (path === "/story-settings")
      return jsonResponse(200, { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "" });
    if (path === "/item-lists")
      return jsonResponse(200, { items: [], defaultListId: null });
    // Today (#47) reads these two; without stubs they fall into the catch-all
    // below, whose shape is not a valid payload for either.
    if (path === "/focus-set")
      return jsonResponse(200, { size: 0, items: [] });
    if (path === "/marumori")
      return jsonResponse(200, { connected: false, lastSync: null, lastFailure: null, counts: null });
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

  await user.click(await screen.findByRole("button", { name: "Server" }));
  await screen.findByDisplayValue("http://10.0.2.2:8080");

  // Hardware Back equivalent: expo-router drives its stack from the history
  // that Android's Back maps to on native, so history.back() pops the section
  // onto the hub.
  window.history.back();
  await screen.findByText("Starting Level");
  expect(screen.queryByDisplayValue("http://10.0.2.2:8080")).toBeNull();
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
  renderApp("/settings/server"); // deep link in a fresh tab: nothing to pop
  const user = await signedIn();

  await screen.findByDisplayValue("http://10.0.2.2:8080");
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
  await screen.findByText("Your known and learning grammar points will appear here.");
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
