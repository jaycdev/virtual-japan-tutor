import { useRef } from "react";

/**
 * A text input for an IANA timezone name (the Learner's Timezone, GLOSSARY.md)
 * with autocomplete over a curated list of common zones and a one-click
 * suggestion of the browser's own zone. The list is a convenience, not a
 * whitelist: the server accepts any name its tzdata knows (`invalid_timezone`
 * otherwise), so free text like "Europe/Zurich" is fine even though the
 * datalist will not show it.
 */

// Common zones, Japanese-learner order first: East Asia, then the rest of the
// world by region. Roughly what a learner would type; anything else still
// saves if the server can load it.
const ZONES = [
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

/** The browser's own zone, or null where the platform does not report one. */
export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function TimezoneAutocomplete({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const listId = `${id}-choices`;
  const inputRef = useRef<HTMLInputElement>(null);

  const suggest = () => {
    const zone = browserTimezone();
    if (!zone) return;
    onChange(zone);
    // Let the Learner see what was filled in.
    inputRef.current?.focus();
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        name="timezone"
        type="text"
        maxLength={64}
        list={listId}
        placeholder="Asia/Tokyo — empty = the server's day"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>{" "}
      <button type="button" disabled={disabled} onClick={suggest}>
        Use my browser&apos;s timezone
      </button>
    </>
  );
}
