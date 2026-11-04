// The route guard. Signed-out visitors are sent to /login?next=<the page they
// asked for>, and the login page sends them back there. Signed-in visitors get the
// app shell. Loading and server-unreachable states never get this far: the
// SessionBoundary above the router shows them.
import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { decideLandingSetup } from "@vjt/core";

import { localKeyValueStore } from "../storage.ts";
import { useSession } from "../session/session.tsx";
import { loginPathFor } from "./nextPath.ts";

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
    <>
      <LandingSetupGate />
      <Outlet />
    </>
  );
}

/**
 * First-run redirect (ui-plan 4.7, #50): on the landing page, a Learner who has
 * never seen setup and has no Starting Level yet goes to /setup. It runs once
 * per signed-in session, the first time the landing page is shown. It remounts
 * after a logout, so the next login checks again.
 */
function LandingSetupGate() {
  const { client, state } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const checked = useRef(false);
  const onLanding = location.pathname === "/";

  useEffect(() => {
    if (state.status !== "signedIn" || !onLanding || checked.current) return;
    checked.current = true;
    decideLandingSetup(client, localKeyValueStore)
      .then((decision) => {
        if (decision === "show-setup") navigate("/setup", { replace: true });
      })
      .catch(() => {
        // Inconclusive: stay on the landing page; the check runs again next session.
      });
  }, [state.status, onLanding, client, navigate]);

  return null;
}
