import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Inline loading indicator for panels and drill-downs: spinner plus what is loading. */
export function Spinner({
  label = "Loading…",
  className,
  size = "md",
}: {
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 text-muted-foreground",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      <Loader2
        className={cn("shrink-0 animate-spin text-primary", size === "sm" ? "size-3.5" : "size-4")}
      />
      <span>{label}</span>
    </div>
  );
}
