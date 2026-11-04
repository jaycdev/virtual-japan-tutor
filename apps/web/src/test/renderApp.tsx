// Mounts the real route table (appRoutes) under a memory router and a session
// that behaves like useAuth: login checks one known account, logout signs out,
// and the API client answers GET /starting-level from the options. Tests drive
// the real guard, login page and shell; only the network and storage are fake.
import { useMemo, useState, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createApiClient, type User } from "@vjt/api-client";
import type { AuthState } from "@vjt/core";

import { appRoutes } from "../appRoutes.tsx";
import { SessionContext, type Session } from "../session/session.tsx";

export const TEST_USER: User = { id: "11111111-1111-4111-8111-111111111111", username: "ada" };
export const TEST_PASSWORD = "correct horse";

export interface HarnessOptions {
  /** Whether the account already has a Starting Level (false sends a new Learner to /setup). */
  startingLevelConfigured?: boolean;
  /** Start signed in (the default) or signed out. */
  signedIn?: boolean;
}

export function renderAppAt(path: string, options: HarnessOptions = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const { startingLevelConfigured = true, signedIn = true } = options;

  function Harness({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>(signedIn ? { status: "signedIn", user: TEST_USER } : { status: "signedOut" });
    const [busy, setBusy] = useState(false);
    const [endedByChoice, setEndedByChoice] = useState(false);

    const client = useMemo(
      () =>
        createApiClient({
          baseUrl: "http://api.test",
          fetch: async (req) => {
            if (new URL(req.url).pathname === "/starting-level") {
              return Response.json({ id: TEST_USER.id, username: TEST_USER.username, configured: startingLevelConfigured });
            }
            return Response.json({ message: "not found" }, { status: 404 });
          },
        }),
      [],
    );

    const session: Session = useMemo(
      () => ({
        state,
        busy,
        client,
        retry: () => undefined,
        endedByChoice,
        login: async (username, password) => {
          setEndedByChoice(false);
          setBusy(true);
          await Promise.resolve();
          setBusy(false);
          if (username === TEST_USER.username && password === TEST_PASSWORD) {
            setState({ status: "signedIn", user: TEST_USER });
          } else {
            setState({ status: "signedOut", error: "Wrong username or password." });
          }
        },
        logout: async () => {
          setEndedByChoice(true);
          setState({ status: "signedOut" });
        },
      }),
      [state, busy, client, endedByChoice],
    );

    return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
  }

  const view = render(
    <Harness>
      <RouterProvider router={router} />
    </Harness>,
  );
  return { router, ...view };
}

/** The current location as the router sees it, e.g. "/login?next=%2Fstories". */
export function currentLocation(router: ReturnType<typeof createMemoryRouter>): string {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
}
