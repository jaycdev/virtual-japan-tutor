// The desktop breakpoint for Settings (ui-plan 3, 4.7): from 1024 px the section
// list and the open section share the page; below it the hub list and each
// section are separate pages. Matches the shell's sidebar breakpoint (Tailwind lg).
import { useEffect, useState } from "react";

export const WIDE_QUERY = "(min-width: 1024px)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => matches(WIDE_QUERY));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return wide;
}
