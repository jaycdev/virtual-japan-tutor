/** The JLPT level pill: secondary surface, foreground text, the same for every level (ui-plan 2.2). */
export function JlptBadge({ level }: { level: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-caption font-semibold text-secondary-foreground">
      {level}
    </span>
  );
}
