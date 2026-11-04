// The form parts the Settings sections and the setup wizard share (ui-plan 4.7,
// 5). Every field has a visible, associated label; errors are inline and linked
// to their field; save state is announced. Controls are shadcn/ui or native
// elements with the same tokens, so keyboard and screen-reader behaviour is the
// browser's own.
import type { ComponentProps, ReactNode, Ref } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A section's own heading below the page title. Focusable (tabIndex -1) so a
 * control that unmounts on click (a detail opening, a confirm dismissing) can
 * move focus here instead of dropping it to <body> (issue #81 review).
 */
export function Subheading({ children, ref }: { children: ReactNode; ref?: Ref<HTMLHeadingElement> }) {
  return (
    <h2 ref={ref} tabIndex={-1} className="text-title-sm font-semibold text-foreground focus:outline-none">
      {children}
    </h2>
  );
}

/** Explanatory text for a section (secondary text, ui-plan 2.4 `small`). */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-small text-muted-foreground">{children}</p>;
}

/** A labelled text field. `hint` and `error` are linked with aria-describedby. */
export function TextField({
  id,
  label,
  hint,
  error,
  className,
  ...input
}: Omit<ComponentProps<"input">, "id"> & { id: string; label: string; hint?: string; error?: string }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-small text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A group of choices as toggle buttons (aria-pressed), the pattern Appearance
 * already uses. Wrapped in a fieldset so the legend names the group.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-body font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={String(option.value)}
              type="button"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A switch with its label and hint, as one row. The native checkbox keeps Space and the role. */
export function SwitchField({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="text-body font-medium text-foreground">
          {label}
        </Label>
        {hint ? (
          <p id={hintId} className="text-small text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </div>
  );
}

/** Where a save stands. The status line is announced to screen readers. */
export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message?: string } | { kind: "error"; message: string };

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "saving") {
    return (
      <p role="status" className="text-small text-muted-foreground">
        Saving…
      </p>
    );
  }
  if (state.kind === "saved") {
    return (
      <p role="status" className="text-small text-success">
        {state.message ?? "Saved."}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-small text-destructive">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Read-only facts (the Server address, the key state). */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-small font-medium text-muted-foreground">{label}</dt>
      <dd className="text-body text-foreground">{children}</dd>
    </div>
  );
}

/** The column every section stacks in. */
export function SectionBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
