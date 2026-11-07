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
import { InterfaceLanguageGate } from "../interfacelanguage";

export const TEST_USER: User = { id: "11111111-1111-4111-8111-111111111111", username: "ada" };
export const TEST_PASSWORD = "correct horse";

export interface HarnessOptions {
  /** Whether the account already has a Starting Level (false sends a new Learner to /setup). */
  startingLevelConfigured?: boolean;
  /** Start signed in (the default) or signed out. */
  signedIn?: boolean;
  /** Replaces the GET /starting-level answer, e.g. to hold it open or fail it. */
  startingLevelReply?: () => Promise<Response>;
  /** Replaces the whole fetch stub (see test/fakeApi.ts for the stateful one). */
  fetchOverride?: (req: Request) => Promise<Response>;
  /**
   * Answers the API paths a test is about. Return undefined to fall through to the
   * defaults above. Used by the Settings tests (see test/fakeSettingsApi.ts).
   */
  api?: (request: Request) => Promise<Response | undefined>;
}

export function renderAppAt(path: string, options: HarnessOptions = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const { startingLevelConfigured = true, signedIn = true, startingLevelReply, fetchOverride, api } = options;

  function Harness({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>(signedIn ? { status: "signedIn", user: TEST_USER } : { status: "signedOut" });
    const [busy, setBusy] = useState(false);
    const [endedByChoice, setEndedByChoice] = useState(false);

    const client = useMemo(
      () =>
        createApiClient({
          baseUrl: "http://api.test",
          fetch: async (req) => {
            if (fetchOverride) return fetchOverride(req);
            if (api) {
              const handled = await api(req);
              if (handled) return handled;
            }
            if (new URL(req.url).pathname === "/starting-level") {
              if (startingLevelReply) return startingLevelReply();
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
        clearEndedByChoice: () => setEndedByChoice(false),
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
      <InterfaceLanguageGate>
        <RouterProvider router={router} />
      </InterfaceLanguageGate>
    </Harness>,
  );
  return { router, ...view };
}

/** The current location as the router sees it, e.g. "/login?next=%2Fstories". */
export function currentLocation(router: ReturnType<typeof createMemoryRouter>): string {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
}
