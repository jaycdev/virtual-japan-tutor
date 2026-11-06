// The route table (ui-plan 3). Every screen is a lazy module, so the first
// load is the shell, the login page and whatever the Learner opens.
import { useEffect } from "react";
import { Link, Outlet, type RouteObject } from "react-router";
import { useT } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { SkeletonLines } from "./components/states.tsx";
import { T } from "./components/Text.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { RequireSession } from "./routes/RequireSession.tsx";
import { documentTitle, useRouteTitle, type RouteHandle } from "./routeTitle.ts";

/**
 * Shown while a lazy route module loads for the first time (React Router asks for
 * this on the root route). A skeleton, not a spinner (ui-plan 5).
 */
function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <SkeletonLines lines={3} />
      </div>
    </div>
  );
}

/** Sets document.title from the deepest matched route that declares one, in the Interface Language. */
function TitleSync() {
  const title = useRouteTitle();
  const { language } = useT();
  useEffect(() => {
    document.title = documentTitle(title, language);
  }, [title, language]);
  return <Outlet />;
}

function NotFound() {
  const { tp } = useT();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title font-semibold text-foreground">
        <T k="title.notFound" />
      </h1>
      <EmptyState
        message={tp("notFound.message")}
        action={
          <Button asChild variant="outline">
            <Link to="/"><T k="notFound.goToToday" /></Link>
          </Button>
        }
      />
    </section>
  );
}

export const appRoutes: RouteObject[] = [
  {
    element: <TitleSync />,
    HydrateFallback: RouteFallback,
    children: [
      {
        path: "login",
        handle: { title: "title.logIn" } satisfies RouteHandle,
        lazy: () => import("./routes/LoginPage.tsx"),
      },
      {
        // The guard: signed-out visitors never reach the shell below.
        element: <RequireSession />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, handle: { title: "nav.today" } satisfies RouteHandle, lazy: () => import("./routes/TodayPage.tsx") },
              { path: "stories", handle: { title: "nav.stories" } satisfies RouteHandle, lazy: () => import("./routes/StoriesPage.tsx") },
              {
                path: "stories/:storyId",
                // wide: the reader lifts the shell's 960 px cap so the 40-character
                // column keeps its width at the L and XL Story text sizes.
                handle: { title: "story.noGenre", wide: true } satisfies RouteHandle,
                lazy: () => import("./routes/StoryPage.tsx"),
              },
              { path: "practice", handle: { title: "nav.practice" } satisfies RouteHandle, lazy: () => import("./routes/PracticePage.tsx") },
              {
                path: "grammar",
                handle: { title: "nav.grammar" } satisfies RouteHandle,
                lazy: () => import("./routes/GrammarPage.tsx"),
              },
              {
                path: "grammar/:grammarId",
                handle: { title: "focus.grammarPoint" } satisfies RouteHandle,
                lazy: () => import("./routes/GrammarPointPage.tsx"),
              },
              // /settings is the hub (narrow) or Appearance (wide); both routes share one module.
              // shellFocus: false — the page marks its own heading so switching sections
              // keeps the rail immediately before the content in the tab order.
              { path: "settings", handle: { title: "nav.settings", shellFocus: false } satisfies RouteHandle, lazy: () => import("./routes/SettingsPage.tsx") },
              {
                path: "settings/:section",
                handle: { title: "nav.settings", shellFocus: false } satisfies RouteHandle,
                lazy: () => import("./routes/SettingsPage.tsx"),
              },
              { path: "setup", handle: { title: "title.setUp" } satisfies RouteHandle, lazy: () => import("./routes/SetupPage.tsx") },
              { path: "*", handle: { title: "title.notFound" } satisfies RouteHandle, Component: NotFound },
            ],
          },
        ],
      },
    ],
  },
];
