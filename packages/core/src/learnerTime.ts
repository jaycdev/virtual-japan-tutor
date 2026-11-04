import type { Story } from "@vjt/api-client";

/**
 * The Learner's clock (plan 4.4 item 1): the greeting, the date and the time on
 * the Last Sync line are read in the Learner's Timezone, not the device's. An
 * empty or unknown zone name means the server's rule too: "unset" is the
 * server's own day, so the device's zone stands in for it. Shared by web and
 * mobile (issue #79 moved it here from apps/mobile's Today screen).
 */

/** An IANA name the runtime can load, or undefined to follow the device. */
export function normalizeTimezone(timezone: string | undefined | null): string | undefined {
  if (!timezone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

/** The pieces of the instant, in the zone, without trusting a locale's order. */
function readParts(
  now: Date,
  zone: string | undefined,
  want: Intl.DateTimeFormatPartTypes[],
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const part of parts) {
      if (want.includes(part.type)) out[part.type] = part.type === "hour" ? part.value.padStart(2, "0") : part.value;
    }
    return out;
  } catch {
    return {};
  }
}

/** The day's three greetings; the small hours get their own, since learners keep odd hours. */
export function greetingFor(hourText: string): string {
  // Some engines hand back "24" for midnight under hour12: false.
  const hour = Number.parseInt(hourText, 10) % 24;
  if (Number.isNaN(hour)) return "Hello";
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Still studying";
}

/**
 * The Learner's greeting and date, from the Learner's Timezone rather than the
 * device's: a Learner in Osaka opening the app at 07:30 sees "Good morning" and
 * their own Wednesday even when the phone or browser is set elsewhere.
 */
export function learnerClock(
  now: Date,
  timezone: string | undefined | null,
): { greeting: string; date: string } {
  const zone = normalizeTimezone(timezone);
  const parts = readParts(now, zone, ["hour", "weekday", "month", "day"]);
  const hour = parts.hour ?? String(now.getHours());
  const weekday = parts.weekday ?? now.toLocaleDateString(undefined, { weekday: "long" });
  const month = parts.month ?? "";
  const day = parts.day ?? String(now.getDate());
  return { greeting: greetingFor(hour), date: `${weekday}, ${month} ${day}` };
}

/** An instant in the Learner's Timezone: "November 4, 14:02". A bad zone falls back to the device's. */
export function formatInstant(iso: string, timezone: string | undefined | null): string {
  const zone = normalizeTimezone(timezone);
  const parts = readParts(new Date(iso), zone, ["month", "day", "hour", "minute"]);
  if (!parts.month || !parts.day || !parts.hour || !parts.minute) return new Date(iso).toLocaleString();
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`;
}

/** The local calendar day of an instant in the zone, as YYYY-MM-DD (sortable as text). */
export function localDayKey(instant: Date, timezone: string | undefined | null): string {
  const zone = normalizeTimezone(timezone);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * The "Still unread from Monday." hint (issue #62): when Today's Story is an
 * Automatic Story the Learner has not read and it belongs to an earlier local
 * day, the weekday it belongs to. Null otherwise.
 */
export function stillUnreadFrom(story: Story, now: Date, timezone: string | undefined | null): string | null {
  if (story.readAt || story.origin === "on_demand") return null;
  const created = new Date(story.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  if (!(localDayKey(created, timezone) < localDayKey(now, timezone))) return null;
  const zone = normalizeTimezone(timezone);
  return readParts(created, zone, ["weekday"]).weekday ?? null;
}
