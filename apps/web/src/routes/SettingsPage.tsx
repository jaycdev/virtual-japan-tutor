// /settings/:section. Appearance is real here because the theme and the Story
// text size live in this issue (ui-plan 2.3, 2.4, 4.7). The other sections are
// built in #81 and show the placeholder until then.
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useThemePreference } from "../theme/index.ts";
import { useStoryTextSize } from "../storysize/index.ts";
import { STORY_TEXT_SIZES } from "../storysize/store.ts";
import { ComingSoon } from "./ComingSoon.tsx";

export function Component() {
  const { section } = useParams();
  if (section === "appearance") return <Appearance />;
  return <ComingSoon title="Settings" issue={81} />;
}

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function Appearance() {
  const { preference, setPreference } = useThemePreference();
  const { size, setSize } = useStoryTextSize();

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-title font-semibold text-foreground">Appearance</h1>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold text-foreground">Theme</legend>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={preference === option.value ? "default" : "outline"}
              aria-pressed={preference === option.value}
              onClick={() => setPreference(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-small text-muted-foreground">Saved on this device. System follows your computer.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold text-foreground">Story text size</legend>
        <div className="flex flex-wrap gap-2">
          {STORY_TEXT_SIZES.map((option) => (
            <Button
              key={option}
              variant={size === option ? "default" : "outline"}
              aria-pressed={size === option}
              onClick={() => setSize(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <p
          lang="ja"
          className="mt-2 font-serif text-foreground"
          style={{ fontSize: "var(--story-text-size)", lineHeight: "var(--story-line-height)" }}
        >
          吾輩は猫である。名前はまだ無い。
        </p>
      </fieldset>
    </section>
  );
}
