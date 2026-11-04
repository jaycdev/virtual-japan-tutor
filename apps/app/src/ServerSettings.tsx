import type { ApiClient } from "@vjt/api-client";
import { useHealth } from "@vjt/core";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";
import { normalizeServerUrl } from "./config.ts";

/**
 * The server connection (#50, split by platform):
 *
 * - Android has no same-origin default, so the API base URL stays editable
 *   here and persists in the device's secure store. Saving rebuilds the API
 *   client and re-runs the session check, so an unreachable address shows
 *   its error right away and a corrected one reconnects without an app
 *   restart.
 * - Web builds serve from the server itself: the address is the page's
 *   origin, fixed at build time, so there is no address field to edit —
 *   only the health check.
 *
 * The health line reads GET /health through `useHealth`, which fetches on
 * mount; "Check again" bumps the inner component's key so a fresh mount
 * fetches again.
 */
export function ServerSettings({
  client,
  currentUrl,
  onSave,
}: {
  client: ApiClient;
  currentUrl: string;
  onSave: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Bumped by "Check again"; keys the health child so it refetches (see above).
  const [attempt, setAttempt] = useState(0);

  const save = async () => {
    const next = normalizeServerUrl(url);
    if (!next) {
      setError("Enter the full address, like http://192.168.1.10:8080");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(next);
      setUrl(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the address");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-4">
      <Text className="text-body text-foreground">
        {Platform.OS === "android"
          ? "The app talks to your Virtual Japan Tutor server at this address."
          : "This build is served by the Virtual Japan Tutor server itself — the address comes from the page."}
      </Text>

      <HealthLine
        key={attempt}
        client={client}
        onRecheck={() => setAttempt((n) => n + 1)}
      />

      {Platform.OS === "android" && (
        <>
          <Text className="text-small text-muted-foreground">Currently: {currentUrl}</Text>
          <Field
            label="Server address"
            value={url}
            onChangeText={setUrl}
            onSubmit={() => void save()}
            keyboardType="url"
            placeholder="http://192.168.1.10:8080"
            disabled={busy}
          />
          <ActionButton label="Save server" onPress={() => void save()} filled disabled={busy} />
          {error && <InlineError message={error} />}
          <LinkButton
            label="Use the emulator default (http://10.0.2.2:8080)"
            onPress={() => setUrl("http://10.0.2.2:8080")}
            disabled={busy}
          />
        </>
      )}
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
        <Text role="status" accessibilityLiveRegion="polite" className="text-body text-success">
          The server is reachable and its database is connected.
        </Text>
      )}
      {health.state === "degraded" && (
        <Text role="status" accessibilityLiveRegion="polite" className="text-body text-destructive">
          The server answered, but {health.health.database === "unreachable" ? "cannot reach its database" : "reports a degraded part"}.
        </Text>
      )}
      {health.state === "error" && (
        <InlineError message={`Cannot reach the server: ${health.message}`} onRetry={onRecheck} />
      )}
      {health.state !== "error" && (
        <LinkButton label="Check again" onPress={onRecheck} />
      )}
    </View>
  );
}
