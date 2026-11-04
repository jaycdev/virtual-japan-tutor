import { cn } from "@/lib/utils";

/** The 読 mark in the serif face, indigo on paper (ui-plan 2.6). Decorative: the app name sits beside it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("font-serif leading-none text-primary", className)}>
      読
    </span>
  );
}
