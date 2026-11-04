// Login (ui-plan 4.2): the wordmark, Username and Password, and errors inline.
// The API is on this origin, so there is no server field. The auth machine is
// @vjt/core's useAuth (through the session); this file is presentation only.
import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "../session/session.tsx";
import { safeNextPath } from "./nextPath.ts";
import { Wordmark } from "../shell/Wordmark.tsx";

export function Component() {
  const { state, busy, login } = useSession();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const next = safeNextPath(params.get("next"), window.location.origin);

  // Already signed in (or just signed in): go where the Learner was headed.
  if (state.status === "signedIn") return <Navigate to={next} replace />;

  const error = state.status === "signedOut" ? state.error : undefined;
  const canSubmit = !busy && username !== "" && password !== "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    void login(username, password);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-border bg-card p-6 shadow-md">
        <div className="flex flex-col items-center gap-1">
          <Wordmark className="text-display" />
          <h1 className="text-title-sm font-semibold text-foreground">Virtual Japan Tutor</h1>
        </div>

        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-small text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={!canSubmit}>
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
