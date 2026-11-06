// Last Sync (plan 4.4 item 5): when the last run finished, what it found, and a
// Sync now. A failure that is still the newest news (the server's `lastFailure`)
// is what the line reports, in destructive, with the same way out as the
// Settings section.
import type { MaruMoriSyncRun } from "@vjt/api-client";
import {
  formatInstant,
  pluralEn,
  useT,
  type InterfaceLanguage,
  type MaruMori,
} from "@vjt/core";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { T } from "@/components/Text.tsx";

export function SyncCard({
  marumori,
  timezone,
}: {
  marumori: MaruMori;
  timezone: string | undefined;
}) {
  const { language } = useT();
  const [syncing, setSyncing] = useState(false);
  // The note is a <T> element, not a resolved string: it stays in the Learner's
  // language if they switch while it is on screen (issue #125 review B3).
  const [syncNote, setSyncNote] = useState<ReactNode>(null);

  const connected = marumori.state.status === "ready" && marumori.state.marumori.connected;

  const syncNow = () => {
    setSyncing(true);
    setSyncNote(null);
    void marumori.sync().then((outcome) => {
      setSyncing(false);
      if ("status" in outcome && outcome.status === "error") {
        // The call itself failed (network, auth): the hook's own words.
        setSyncNote(outcome.message);
      } else if (outcome.status === "failed") {
        // The run ran and failed: the server's Learner-facing reason, which
        // is more useful than anything the screen could invent (issue #47
        // review S1).
        setSyncNote(outcome.error ?? <T k="today.syncFailedFallback" />);
      } else {
        // sync() already re-read the status on success, so the Last Sync line
        // under this note is the fresh one without a second reload (S3).
        setSyncNote(<T k="today.syncSucceededNote" />);
      }
    });
  };

  return (
    <Card className="gap-3 px-6" aria-labelledby="sync-heading" data-testid="today-sync-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sync-heading" className="text-title-sm font-semibold text-foreground">
          <T k="today.lastSyncHeading" />
        </h2>
        <Button
          variant="outline"
          onClick={syncNow}
          disabled={syncing || marumori.state.status !== "ready" || !connected}
          data-testid="today-sync-now"
        >
          {syncing ? <T k="today.syncSyncing" /> : <T k="today.syncNow" />}
        </Button>
      </div>

      {marumori.state.status === "loading" ? (
        // Shaped like the settled Last Sync line: a timestamp line and the
        // shorter counts line (issue #47 review S7).
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ) : marumori.state.status === "error" ? (
        <ErrorState message={marumori.state.message} onRetry={marumori.reload} />
      ) : !connected ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-muted-foreground">
            <T k="today.syncNotLinked" />
          </p>
          <Button asChild variant="outline">
            <Link to="/settings/marumori">
              <T k="today.syncLinkMaruMori" />
            </Link>
          </Button>
        </div>
      ) : (
        <SyncLine marumori={marumori} timezone={timezone} language={language} />
      )}

      {syncNote ? (
        <p role="status" aria-live="polite" className="text-caption text-muted-foreground">
          {syncNote}
        </p>
      ) : null}
    </Card>
  );
}

function SyncLine({
  marumori,
  timezone,
  language,
}: {
  marumori: MaruMori;
  timezone: string | undefined;
  language: InterfaceLanguage;
}) {
  if (marumori.state.status !== "ready") return null;
  const { lastSync, lastFailure } = marumori.state.marumori;
  // lastFailure is only set while it is the newest news, so whichever of the two
  // is later is the story to tell.
  const failed =
    lastFailure && (!lastSync || newer(lastFailure.startedAt, lastSync.startedAt))
      ? lastFailure
      : undefined;
  if (failed) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-destructive">
          <T k="today.syncFailedLine" params={{ time: formatInstant(failed.finishedAt ?? failed.startedAt, timezone, language) }} />
        </p>
        {failed.error ? <p className="text-small text-muted-foreground">{failed.error}</p> : null}
      </div>
    );
  }
  if (!lastSync) {
    return (
      <p className="text-body text-muted-foreground">
        <T k="today.syncNoneYet" />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {/* Explicit about what the timestamp is (issue #47 review polish): a
          bare clock time does not read as "this sync worked". */}
      <p className="text-body text-foreground">
        <T k="today.syncSucceededLine" params={{ time: formatInstant(lastSync.finishedAt ?? lastSync.startedAt, timezone, language) }} />
      </p>
      <p className="text-small text-muted-foreground">
        {syncResultLine(lastSync, language)}
      </p>
    </div>
  );
}

function newer(a: string, b: string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

function syncResultLine(run: MaruMoriSyncRun, language: InterfaceLanguage): ReactNode {
  const counts = run.counts;
  if (!counts) return <T k="today.syncNoCounts" />;
  // The English column carries the plural -s as a parameter; the Japanese
  // column keeps the same placeholder and always receives "" (issue #125).
  return (
    <T
      k="today.syncResultCounts"
      params={{
        new: counts.new,
        newPlural: pluralEn(language, counts.new),
        levelChanges: counts.levelChanges,
        levelPlural: pluralEn(language, counts.levelChanges),
        linked: counts.linked,
      }}
    />
  );
}
