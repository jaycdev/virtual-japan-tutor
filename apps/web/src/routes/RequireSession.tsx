// The route guard. Signed-out visitors are sent to /login?next=<the page they
// asked for>, and the login page sends them back there. Signed-in visitors get the
// app, held behind the first-run check on the landing page. Loading and
// server-unreachable states never get this far: the SessionBoundary above the
// router shows them.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { decideLandingSetup } from "@vjt/core";

import { SkeletonLines } from "../components/states.tsx";
import { localKeyValueStore } from "../storage.ts";
import { useSession } from "../session/session.tsx";
import { loginPathFor } from "./nextPath.ts";

/**
 * How long the landing page waits for the first-run answer before it shows anyway
 * (the check is advisory: a slow server must not hold the Learner on a skeleton).
 */
export const LANDING_CHECK_TIMEOUT_MS = 3000;

export function RequireSession() {
  const { state, endedByChoice } = useSession();
  const location = useLocation();

  if (state.status === "signedOut") {
    // Log out is not an expiry: do not remember the page the Learner left.
    const from = endedByChoice ? "/" : `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={loginPathFor(from)} replace />;
  }
  if (state.status !== "signedIn") return null;
  return (
    <LandingGate>
      <Outlet />
    </LandingGate>
  );
}

// pending: the landing check has not answered. redirecting: /setup is on its way;
// the landing page stays hidden while the landing location (`key`) is still the
// current one, and stops mattering once the navigation has moved on, so coming
// back to Today later is not held. clear: the page may render (decided, failed,
// or timed out; checked once per session).
type Gate = { kind: "pending" } | { kind: "redirecting"; key: string } | { kind: "clear" };

/**
 * The first-run redirect (ui-plan 4.7, #50) without a flash. On the landing page
 * the Today screen is replaced by a skeleton until GET /starting-level has
 * answered: a Learner with no Starting Level goes to /setup, anyone else sees
 * the page. Errors and the timeout fall through to the page. The state lives in
 * React state (not only a ref) so the gate re-renders when the decision lands.
 */
function LandingGate({ children }: { children: ReactNode }) {
  const { client } = useSession();
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  const [gate, setGate] = useState<Gate>({ kind: "pending" });
  const started = useRef(false);
  const onLanding = pathname === "/";
  const holding =
    onLanding && (gate.kind === "pending" || (gate.kind === "redirecting" && gate.key === key));

  useEffect(() => {
    // A ref guards the single check: StrictMode runs this effect twice.
    if (!holding || gate.kind !== "pending" || started.current) return;
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), LANDING_CHECK_TIMEOUT_MS);
    });
    Promise.race([decideLandingSetup(client, localKeyValueStore), timeout])
      .then((decision) => {
        clearTimeout(timer);
        if (decision === "show-setup") {
          setGate({ kind: "redirecting", key });
          navigate("/setup", { replace: true });
        } else {
          setGate({ kind: "clear" });
        }
      })
      .catch(() => {
        clearTimeout(timer);
        setGate({ kind: "clear" });
      });
  }, [holding, gate.kind, client, navigate, key]);

  if (holding) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6" aria-busy="true" data-gate="first-run">
        <div className="w-full max-w-sm">
          <SkeletonLines lines={3} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
