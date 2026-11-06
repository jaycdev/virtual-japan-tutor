// Settings (ui-plan 4.7). From 1024 px: two panes, the section list on the left
// (links, the open one marked as the current page) and the open section on the
// right. `/settings` goes to Appearance there. Below 1024 px the hub list and each
// section are separate pages: `/settings` is the list, `/settings/:section` the
// section with a Back link. Both layouts come from the same markup and CSS, so
// there is one set of links and one section in the page at a time.
import { Link, Navigate, useParams } from "react-router";
import {
  findSettingsSection,
  sectionBlurb,
  sectionTitle,
  SETTINGS_SECTIONS,
  useT,
  type SettingsSection,
} from "@vjt/core";

import { T } from "@/components/Text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/states.tsx";
import { cn } from "@/lib/utils";
import { AiProvidersSection } from "../settings/sections/AiProvidersSection.tsx";
import { AppearanceSection } from "../settings/sections/AppearanceSection.tsx";
import { ItemListsSection } from "../settings/sections/ItemListsSection.tsx";
import { MaruMoriSection } from "../settings/sections/MaruMoriSection.tsx";
import { FocusSetSection } from "../settings/sections/FocusSetSection.tsx";
import { ReadingSection } from "../settings/sections/ReadingSection.tsx";
import { ServerSection } from "../settings/sections/ServerSection.tsx";
import { StartingLevelSection } from "../settings/sections/StartingLevelSection.tsx";
import { StoriesSection } from "../settings/sections/StoriesSection.tsx";
import { useWideLayout } from "../settings/useWideLayout.ts";

// Today's "See all" deep link. The full Focus Set is not one of the eight hub
// sections (ui-plan 4.4), so this route exists without a list entry.
const FOCUS_DEEP_LINK_ID = "focus" as const;

export function Component() {
  const { language, tp } = useT();
  const { section } = useParams();
  const wide = useWideLayout();
  const found = findSettingsSection(section);
  const isFocus = section === FOCUS_DEEP_LINK_ID;

  // Wide: /settings is not a page of its own, so it lands on Appearance.
  if (!section && wide) return <Navigate to="/settings/appearance" replace />;

  if (section && !found && !isFocus) {
    return (
      <section className="flex flex-col gap-4">
        <h1 tabIndex={-1} data-page-focus className="text-title font-semibold text-foreground">
          <T k="nav.settings" />
        </h1>
        <EmptyState
          message={tp("settings.notFound")}
          action={
            <Button asChild variant="outline">
              <Link to="/settings">
                <T k="settings.back" />
              </Link>
            </Button>
          }
        />
      </section>
    );
  }

  // The hub on a narrow screen: the list alone.
  if (!section) {
    return (
      <section className="flex flex-col gap-6">
        <h1 tabIndex={-1} data-page-focus className="text-title font-semibold text-foreground">
          <T k="nav.settings" />
        </h1>
        <SectionList current={null} />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="hidden lg:block lg:w-56 lg:shrink-0">
        <SectionList current={section as SettingsSection} />
      </aside>

      <section className="flex min-w-0 max-w-2xl flex-1 flex-col gap-6">
        <div className="lg:hidden">
          <Button asChild variant="ghost" className="px-0">
            <Link to="/settings">
              <T k="settings.backShort" />
            </Link>
          </Button>
        </div>
        {/* data-page-focus: the shell focuses this heading after a section switch
            (handle `shellFocus: false`), so Tab reaches the content directly. */}
        <h1 tabIndex={-1} data-page-focus className="text-title font-semibold text-foreground focus:outline-none">
          {isFocus ? tp("settings.focusTitle") : found ? sectionTitle(found.id, language) : ""}
        </h1>
        <SectionContent section={isFocus ? FOCUS_DEEP_LINK_ID : (section as SettingsSection)} />
      </section>
    </div>
  );
}

/** The section list: one link per section, the open one marked with aria-current. */
function SectionList({ current }: { current: SettingsSection | null }) {
  const { language, tp } = useT();
  return (
    <nav aria-label={tp("settings.sectionsAria")}>
      <ul className="flex flex-col gap-1">
        {SETTINGS_SECTIONS.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id}>
              <Link
                to={`/settings/${item.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-accent font-semibold text-accent-foreground" : "text-foreground hover:bg-accent",
                )}
              >
                <span>{sectionTitle(item.id, language)}</span>
                <span className="text-small font-normal text-muted-foreground">{sectionBlurb(item.id, language)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SectionContent({ section }: { section: SettingsSection | typeof FOCUS_DEEP_LINK_ID }) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "reading":
      return <ReadingSection />;
    case "stories":
      return <StoriesSection />;
    case "lists":
      return <ItemListsSection />;
    case "level":
      return <StartingLevelSection />;
    case "marumori":
      return <MaruMoriSection />;
    case "ai":
      return <AiProvidersSection />;
    case "server":
      return <ServerSection />;
    case "focus":
      return <FocusSetSection />;
  }
}
