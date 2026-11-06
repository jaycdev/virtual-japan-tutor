import type { ApiClient } from "@vjt/api-client";
import { probeServerHealth, useHealth, useT } from "@vjt/core";
import { useState } from "react";
import { View } from "react-native";

import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { T } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";
import { normalizeServerUrl } from "./config.ts";
import { VersionLines } from "./VersionLines.tsx";

/**
 * The server connection (#50). The app has no same-origin default, so the API
 * base URL stays editable here and persists in the device's secure store.
 * Saving first probes the candidate's /health (review S1): an unreachable
 * address explains itself and the old address stays; only a server that
 * answers gets committed, rebuilt into a fresh ApiClient, and re-checked.
 *
 * The health line reads GET /health through `useHealth`, which fetches on
 * mount; "Check again" bumps the inner component's key so a fresh mount
 * fetches again.
 */
// Review S1: the pre-commit probe is in @vjt/core (probeServerHealth). It uses
// the plain global fetch, because the ApiClient still points at the old server.

export function ServerSettings({
  client,
  currentUrl,
  onSave,
}: {
  client: ApiClient;
  currentUrl: string;
  onSave: (url: string) => Promise<void>;
}) {
  const { language, tp: plain } = useT();
  const [url, setUrl] = useState(currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Bumped by "Check again"; keys the health child so it refetches (see above).
  const [attempt, setAttempt] = useState(0);

  const save = async () => {
    const next = normalizeServerUrl(url);
    if (!next) {
      setError(plain("mobile.serverUrlShape"));
      return;
    }
    setBusy(true);
    setError(undefined);
    // Review S1: probe the candidate BEFORE committing. Saving rebuilds the
    // session against the new address — a typo silently signed the Learner
    // out and bounced them to Login with no explanation. A failed probe
    // keeps the old address in place.
    const probeFailure = await probeServerHealth(next, undefined, undefined, language);
    if (probeFailure) {
      setError(probeFailure);
      setBusy(false);
      return;
    }
    try {
      await onSave(next);
      setUrl(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : plain("mobile.serverSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-4">
      <T k="mobile.serverIntro" className="text-body text-foreground" />

      <HealthLine
        key={attempt}
        client={client}
        onRecheck={() => setAttempt((n) => n + 1)}
      />

      <>
          <T k="mobile.serverCurrent" params={{ url: currentUrl }} className="text-small text-muted-foreground" />
          <Field
            label={<T k="server.addressLabel" className="text-small text-muted-foreground" />}
            value={url}
            onChangeText={setUrl}
            onSubmit={() => void save()}
            keyboardType="url"
            placeholder={plain("mobile.serverUrlPlaceholder")}
            disabled={busy}
          />
          {/* Review S1: saving is a sign-out, not a silent switch — say so. */}
          <T k="mobile.serverSignOutNote" className="text-small text-muted-foreground" />
          <ActionButton
            label={<T k="mobile.saveServer" className="text-body font-semibold text-primary-foreground" />}
            onPress={() => void save()}
            filled
            disabled={busy}
          />
          {error && <InlineError message={error} />}
          <LinkButton
            label={<T k="mobile.emulatorDefault" className="text-body text-primary" />}
            onPress={() => setUrl("http://10.0.2.2:8080")}
            disabled={busy}
          />
      </>
    </View>
  );
}

/** One GET /health, re-read on demand by remounting (the hook fetches on mount). */
function HealthLine({ client, onRecheck }: { client: ApiClient; onRecheck: () => void }) {
  const health = useHealth(client);
  if (health.state === "loading") return <SkeletonBar width="60%" height={24} />;
  return (
    <View className="gap-3">
      {health.state === "ok" && (
        <View role="status" accessibilityLiveRegion="polite">
          <T k="server.healthy" className="text-body text-success" />
        </View>
      )}
      {health.state === "degraded" && (
        <View role="status" accessibilityLiveRegion="polite">
          <T
            k={health.health.database === "unreachable" ? "server.answeredButDbUnreachable" : "server.answeredButDegraded"}
            className="text-body text-destructive"
          />
        </View>
      )}
      {(health.state === "ok" || health.state === "degraded") && (
        <VersionLines serverVersion={health.health.version} />
      )}
      {health.state === "error" && (
        <InlineError
          message={<T k="mobile.serverReachFailed" params={{ message: health.message }} />}
          onRetry={onRecheck}
        />
      )}
      {health.state !== "error" && (
        <LinkButton label={<T k="server.checkAgain" className="text-body text-primary" />} onPress={onRecheck} />
      )}
    </View>
  );
}
