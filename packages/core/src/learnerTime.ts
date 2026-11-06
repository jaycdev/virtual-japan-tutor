import type { Story } from "@vjt/api-client";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  type InterfaceLanguage,
} from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";

/**
 * The Learner's clock (plan 4.4 item 1): the greeting, the date and the time on
 * the Last Sync line are read in the Learner's Timezone, not the device's. An
 * empty or unknown zone name means the server's rule too: "unset" is the
 * server's own day, so the device's zone stands in for it. Shared by web and
 * mobile (issue #79 moved it here from apps/mobile's Today screen).
 *
 * Issue #125: the display locale follows the Interface Language — English
 * keeps assembling its own "weekday, month day" pieces, Japanese reads the
 * same instant through ja-JP. The internal YYYY-MM-DD day keys are formatted
 * with en-CA whatever the UI speaks, so comparisons stay plain string sorts.
 */

/** The display locale for an Interface Language ("en-GB" keeps en-CA for keys). */
export function displayLocale(lang: InterfaceLanguage): string {
  return lang === "en" ? "en-US" : "ja-JP";
}

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
  locale: string,
  want: Intl.DateTimeFormatPartTypes[],
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      year: "numeric",
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

const GREETING_KEYS = {
  hello: "greeting.hello",
  morning: "greeting.morning",
  afternoon: "greeting.afternoon",
  evening: "greeting.evening",
  lateNight: "greeting.lateNight",
} as const;

/**
 * The day's three greetings; the small hours get their own, since learners
 * keep odd hours. Returned in English for English UIs and in Japanese for
 * Japanese ones (with the table's furigana dropped: this lands in a string).
 */
export function greetingFor(hourText: string, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  // Some engines hand back "24" for midnight under hour12: false.
  const hour = Number.parseInt(hourText, 10) % 24;
  if (Number.isNaN(hour)) return translatePlain(lang, GREETING_KEYS.hello);
  if (hour >= 5 && hour < 12) return translatePlain(lang, GREETING_KEYS.morning);
  if (hour >= 12 && hour < 18) return translatePlain(lang, GREETING_KEYS.afternoon);
  if (hour >= 18 && hour < 22) return translatePlain(lang, GREETING_KEYS.evening);
  return translatePlain(lang, GREETING_KEYS.lateNight);
}

/**
 * The Learner's greeting and date, from the Learner's Timezone rather than the
 * device's: a Learner in Osaka opening the app at 07:30 sees "Good morning" and
 * their own Wednesday even when the phone or browser is set elsewhere.
 * English keeps its hand-built "Wednesday, November 4"; Japanese lets ja-JP
 * order the same parts (2026年11月4日水曜日).
 */
export function learnerClock(
  now: Date,
  timezone: string | undefined | null,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): { greeting: string; date: string } {
  const zone = normalizeTimezone(timezone);
  const locale = displayLocale(lang);
  const parts = readParts(now, zone, locale, ["hour", "weekday", "year", "month", "day"]);
  const greeting = greetingFor(parts.hour ?? String(now.getHours()), lang);
  if (lang !== "en") {
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    });
    return { greeting, date: fmt.format(now) };
  }
  const weekday = parts.weekday ?? now.toLocaleDateString(undefined, { weekday: "long" });
  const month = parts.month ?? "";
  const day = parts.day ?? String(now.getDate());
  return { greeting, date: `${weekday}, ${month} ${day}` };
}

/**
 * An instant in the Learner's Timezone: "November 4, 14:02", or "11月4日 14:02"
 * in a Japanese UI. A bad zone falls back to the device's.
 */
export function formatInstant(
  iso: string,
  timezone: string | undefined | null,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  const zone = normalizeTimezone(timezone);
  const locale = displayLocale(lang);
  if (lang !== "en") {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso));
    } catch {
      return new Date(iso).toLocaleString();
    }
  }
  const parts = readParts(new Date(iso), zone, locale, ["month", "day", "hour", "minute"]);
  if (!parts.month || !parts.day || !parts.hour || !parts.minute) return new Date(iso).toLocaleString();
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`;
}

/** The local calendar day of an instant in the zone, as YYYY-MM-DD (sortable as text). */
export function localDayKey(instant: Date, timezone: string | undefined | null): string {
  const zone = normalizeTimezone(timezone);
  try {
    // en-CA on purpose, for every Interface Language: this is a comparison
    // key, not display text, and YYYY-MM-DD sorts as a plain string.
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
 * day, the weekday it belongs to. Null otherwise. Japanese UIs get the
 * weekday in ja-JP (月曜日).
 */
export function stillUnreadFrom(
  story: Story,
  now: Date,
  timezone: string | undefined | null,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string | null {
  if (story.readAt || story.origin === "on_demand") return null;
  const created = new Date(story.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  if (!(localDayKey(created, timezone) < localDayKey(now, timezone))) return null;
  const zone = normalizeTimezone(timezone);
  return readParts(created, zone, displayLocale(lang), ["weekday"]).weekday ?? null;
}
