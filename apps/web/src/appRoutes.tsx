// The route table (ui-plan 3). Every screen is a lazy module, so the first
// load is the shell, the login page and whatever the Learner opens.
import { useEffect } from "react";
import { Link, Navigate, Outlet, useMatches, type RouteObject } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { SkeletonLines } from "./components/states.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { RequireSession } from "./routes/RequireSession.tsx";
import { ComingSoon } from "./routes/ComingSoon.tsx";

interface RouteHandle {
  /** Page title; the document title becomes "<title> · Virtual Japan Tutor". */
  title?: string;
}

const APP_NAME = "Virtual Japan Tutor";

/** A not-yet-built destination: a lazy module that renders the placeholder. */
function placeholder(title: string, issue: number) {
  return async () => ({ Component: () => <ComingSoon title={title} issue={issue} /> });
}

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

/** Sets document.title from the deepest matched route that declares one. */
function TitleSync() {
  const matches = useMatches();
  const title = matches
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter((t): t is string => Boolean(t))
    .at(-1);
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
  return <Outlet />;
}

function NotFound() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title font-semibold text-foreground">Not found</h1>
      <EmptyState
        message="There is nothing at this address."
        action={
          <Button asChild variant="outline">
            <Link to="/">Go to Today</Link>
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
        handle: { title: "Log in" } satisfies RouteHandle,
        lazy: () => import("./routes/LoginPage.tsx"),
      },
      {
        // The guard: signed-out visitors never reach the shell below.
        element: <RequireSession />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, handle: { title: "Today" } satisfies RouteHandle, lazy: placeholder("Today", 79) },
              { path: "stories", handle: { title: "Stories" } satisfies RouteHandle, lazy: placeholder("Stories", 79) },
              { path: "stories/:storyId", handle: { title: "Story" } satisfies RouteHandle, lazy: placeholder("Story", 77) },
              { path: "practice", handle: { title: "Practice" } satisfies RouteHandle, lazy: placeholder("Practice", 78) },
              { path: "grammar", handle: { title: "Grammar" } satisfies RouteHandle, lazy: placeholder("Grammar", 80) },
              { path: "grammar/:grammarId", handle: { title: "Grammar point" } satisfies RouteHandle, lazy: placeholder("Grammar point", 80) },
              { path: "settings", element: <Navigate to="/settings/appearance" replace /> },
              {
                path: "settings/:section",
                handle: { title: "Settings" } satisfies RouteHandle,
                lazy: () => import("./routes/SettingsPage.tsx"),
              },
              { path: "setup", handle: { title: "Set up" } satisfies RouteHandle, lazy: () => import("./routes/SetupPage.tsx") },
              { path: "*", handle: { title: "Not found" } satisfies RouteHandle, Component: NotFound },
            ],
          },
        ],
      },
    ],
  },
];
