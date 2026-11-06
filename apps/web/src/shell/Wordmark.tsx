import { cn } from "@/lib/utils";

/** The 読 mark in the serif face, indigo on paper (ui-plan 2.6). Decorative: the app name sits beside it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("font-serif leading-none text-primary", className)}>
      {/* eslint-disable-next-line vjt/no-raw-jsx-text -- the 読 logotype is brand art, not interface text (issue #125) */}
      読
    </span>
  );
}
