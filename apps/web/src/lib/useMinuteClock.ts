// The clock, ticked once a minute: honest across a morning without a per-second
// re-render. Today's greeting and the Stories page's "still unread" hint read
// the time through this one hook, so neither re-renders on every object.
import { useEffect, useState } from "react";

export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
