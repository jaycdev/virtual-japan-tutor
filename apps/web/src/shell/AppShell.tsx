// The app shell (ui-plan 3, 4.2): a sidebar from 1024 px, and a top bar with a
// menu button that opens the same navigation in a sheet below that. Both are
// chosen with CSS (lg:), not JavaScript, so only one navigation is ever in the
// accessibility tree. Content is capped at 960 px except on routes whose handle
// says `wide` (the Story reader, issue #77 review): those keep the full width
// and take less horizontal padding from lg, so the reader's 40-character column
// fits at every Story text size. The skip link, the <main> landmark and the
// route announcements are here so every page gets them.
import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Outlet, useLocation, useMatches } from "react-router";
import { useT } from "@vjt/core";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SkeletonLines } from "../components/states.tsx";
import { T } from "../components/Text.tsx";
import { useLandingHold } from "../routes/RequireSession.tsx";
import { documentTitle, useRouteTitle, type RouteHandle } from "../routeTitle.ts";
import { SideNavContent } from "./SideNav.tsx";
import { Wordmark } from "./Wordmark.tsx";

/** The width at which the sidebar takes over from the top bar (Tailwind's lg). */
const WIDE_QUERY = "(min-width: 1024px)";

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const holding = useLandingHold();
  const { pathname } = useLocation();
  const title = useRouteTitle();
  const { language, tp } = useT();
  // The deepest route may ask for the wide layout (the Story reader, issue #77):
  // no 960 px cap, and less padding from lg so its 40-character column reaches
  // ~1120 px — 40 characters at XL — from a 1280 px window on.
  const wide = useMatches().some((match) => (match.handle as RouteHandle | undefined)?.wide);
  const handle = useMatches().at(-1)?.handle as RouteHandle | undefined;
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);
  const [announcement, setAnnouncement] = useState("");

  // Growing past the breakpoint with the sheet open would leave a modal over the
  // sidebar that now shows the same navigation: close it.
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => {
      if (query.matches) setMenuOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // A client-side navigation moves focus to the new page and announces its title.
  // The first render (and any re-render on the same path) is not a navigation.
  // Routes that swap their own content (Settings sections, handle `shellFocus: false`)
  // mark a heading with data-page-focus: focusing that instead of <main> keeps the
  // rail immediately before the content in the tab order.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const target =
      handle?.shellFocus === false
        ? (mainRef.current?.querySelector<HTMLElement>("[data-page-focus]") ?? mainRef.current)
        : mainRef.current;
    target?.focus({ preventScroll: true });
    setAnnouncement(documentTitle(title, language));
  }, [pathname, title, handle, language]);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Two forms of the same words: the visible one carries furigana in
          ja-furigana but is hidden from assistive tech outright; the plain
          tp() span gives the link its accessible name, so a screen reader
          never says the reading too. The inner sr-only span stays hidden when
          the link is focused (focus:not-sr-only applies to the link), and the
          ruby form is only drawn then, clipped by the link's own sr-only
          otherwise. #125 round-3 review S2 (was V2). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-body focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span aria-hidden="true"><T k="shell.skipToContent" /></span>
        <span className="sr-only">{tp("shell.skipToContent")}</span>
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-border bg-card lg:flex">
        <SideNavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2 lg:hidden">
          <div className="flex items-center gap-2">
            <Wordmark className="text-title" />
            <span className="text-small font-semibold text-muted-foreground"><T k="brand.app" /></span>
          </div>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={tp("shell.openNavigation")}>
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="gap-0 p-0">
              {/* Plain tp(), not <T>: this header is sr-only, never drawn, and a
                  <ruby> inside it would have a screen reader say the reading too
                  (#125 round-3 review S1). */}
              <SheetHeader className="sr-only">
                <SheetTitle>{tp("shell.navTitle")}</SheetTitle>
                <SheetDescription>{tp("shell.navDescription")}</SheetDescription>
              </SheetHeader>
              <div className="flex h-full flex-col justify-between overflow-y-auto">
                <SideNavContent onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        {/* Announces each client-side navigation to screen readers (ui-plan 6). */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            "mx-auto w-full flex-1 px-4 py-6 focus:outline-none sm:px-6",
            // Wide routes trade padding for width from lg: the reader column is
            // centred inside whatever main gives it, so the padding only ever
            // bites when the window is barely wider than the column.
            wide ? "lg:px-4" : "max-w-[960px] lg:px-8",
          )}
        >
          {holding ? (
            // The first-run check is still answering: a skeleton, not Today (ui-plan 5).
            <div data-gate="first-run" aria-busy="true">
              <SkeletonLines lines={3} />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
