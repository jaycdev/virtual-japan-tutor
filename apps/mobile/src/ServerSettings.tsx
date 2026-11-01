import { useState } from "react";

import { normalizeServerUrl } from "./config.ts";
import { Body, ErrorText, Field, LinkButton, Muted, PrimaryButton, Screen, Scroll, Title } from "./ui.tsx";

/**
 * The server connection (issue #13): a phone cannot use the web app's
 * same-origin default, so the API base URL is editable here and persisted in
 * the device's secure store. Saving rebuilds the API client and re-runs the
 * session check, so an unreachable address shows its error right away and a
 * corrected one reconnects without an app restart.
 */
export function ServerSettings({
  currentUrl,
  onSave,
  onBack,
}: {
  currentUrl: string;
  onSave: (url: string) => Promise<void>;
  onBack: () => void;
}) {
  const [url, setUrl] = useState(currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    <Screen>
      <Scroll>
        <Title text="Server" onBack={onBack} />
        <Body text="The app talks to your Virtual Japan Tutor server at this address." />
        <Muted text={`Currently: ${currentUrl}`} />
        <Field
          label="Server address"
          value={url}
          onChangeText={setUrl}
          onSubmit={() => void save()}
          keyboardType="url"
          placeholder="http://192.168.1.10:8080"
          disabled={busy}
        />
        <PrimaryButton label="Save server" onPress={() => void save()} disabled={busy} />
        {error && <ErrorText text={error} />}
        <LinkButton
          label="Use the emulator default (http://10.0.2.2:8080)"
          onPress={() => setUrl("http://10.0.2.2:8080")}
          disabled={busy}
        />
      </Scroll>
    </Screen>
  );
}
