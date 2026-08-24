import { cn } from "@/lib/utils";

/** A single shimmering placeholder bar. Uses the muted token so it themes. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-sm bg-muted", className)} />;
}

/**
 * Placeholder table rows shown during the first data fetch so panes don't pop in
 * from empty. Widths vary per column to read like real content, not a grid.
 */
export function SkeletonRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  const widths = ["w-40", "w-20", "w-16", "w-24", "w-12", "w-28"];
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-t">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-2.5">
              <Skeleton className={cn("h-3", widths[c % widths.length])} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
