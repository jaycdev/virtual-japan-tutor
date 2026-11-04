import { BookOpen, Dumbbell, GraduationCap, House, Settings, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

import { cn } from "@/lib/utils";
import { DESTINATIONS, activeDestination } from "./destinations.ts";

const ICONS: Record<string, LucideIcon> = {
  "/": House,
  "/stories": BookOpen,
  "/practice": Dumbbell,
  "/grammar": GraduationCap,
  "/settings": Settings,
};

/**
 * The five destinations as links. The current one gets aria-current="page" and
 * the accent colour. `onNavigate` lets the mobile sheet close after a tap.
 */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const active = activeDestination(pathname);
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-1">
        {DESTINATIONS.map(({ path, label }) => {
          const selected = path === active;
          const Icon = ICONS[path] ?? House;
          return (
            <li key={path}>
              <Link
                to={path}
                aria-current={selected ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-body outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "bg-accent font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
