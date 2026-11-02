/**
 * The data behind the Learner's Timezone picker (issue #32), shared by the web
 * and mobile Timezone fields (#34): a curated list of common IANA zones and the
 * device's own zone for the one-click suggestion. The list is a convenience,
 * not a whitelist: the server accepts any name its tzdata knows
 * (`invalid_timezone` otherwise), so free text like "Europe/Zurich" still saves.
 */

// Common zones, Japanese-learner order first: East Asia, then the rest of the
// world by region. Roughly what a learner would type; anything else still
// saves if the server can load it.
export const TIMEZONE_OPTIONS = [
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Jerusalem",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/Vienna",
  "Europe/Prague",
  "Europe/Budapest",
  "Europe/Berlin",
  "Europe/Copenhagen",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Dublin",
  "Europe/London",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Casablanca",
  "Asia/Almaty",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/Mexico_City",
  "America/Winnipeg",
  "America/New_York",
  "America/Toronto",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "Atlantic/Reykjavik",
  "UTC",
];

/** The device's own zone, or null where the platform does not report one. */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
