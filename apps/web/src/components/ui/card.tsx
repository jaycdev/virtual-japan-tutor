import * as React from "react";

import { cn } from "@/lib/utils";

// A surface for grouped content (ui-plan 2.2: card on background, border token).
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-4 rounded-lg border border-border bg-card p-5 text-card-foreground", className)}
      {...props}
    />
  );
}

export { Card };
