import { deviceTimezone, TIMEZONE_OPTIONS } from "@vjt/core";
import { useRef } from "react";

/**
 * A text input for an IANA timezone name (the Learner's Timezone, GLOSSARY.md)
 * with autocomplete over a curated list of common zones and a one-click
 * suggestion of the browser's own zone. The list (and the device lookup) live
 * in core so the mobile Timezone field (#34) offers the same picture; the list
 * is a convenience, not a whitelist: the server accepts any name its tzdata
 * knows (`invalid_timezone` otherwise), so free text like "Europe/Zurich" is
 * fine even though the datalist will not show it.
 */

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
    const zone = deviceTimezone();
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
        {TIMEZONE_OPTIONS.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>{" "}
      <button type="button" disabled={disabled} onClick={suggest}>
        Use my browser&apos;s timezone
      </button>
    </>
  );
}
