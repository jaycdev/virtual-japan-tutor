// The app shell (ui-plan 3, 4.2): a sidebar from 1024 px, and a top bar with a
// menu button below that which opens the same navigation in a sheet. Both are
// chosen with CSS (lg:), not JavaScript, so only one navigation is ever in the
// accessibility tree. Content is capped at 960 px. The skip link, the <main>
// landmark and the focus rings are here so every page gets them.
import { useState } from "react";
import { Menu } from "lucide-react";
import { Outlet } from "react-router";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SideNavContent } from "./SideNav.tsx";
import { Wordmark } from "./Wordmark.tsx";

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-body focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between overflow-y-auto border-r border-border bg-card lg:flex">
        <SideNavContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2 lg:hidden">
          <div className="flex items-center gap-2">
            <Wordmark className="text-title" />
            <span className="text-small font-semibold text-muted-foreground">Virtual Japan Tutor</span>
          </div>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Move between Today, Stories, Practice, Grammar and Settings.</SheetDescription>
              </SheetHeader>
              <div className="flex h-full flex-col justify-between overflow-y-auto">
                <SideNavContent onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[960px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
