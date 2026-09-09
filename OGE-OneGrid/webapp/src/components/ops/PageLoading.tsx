/**
 * Shared page-level loading indicator for ops views — a centered spinner with a
 * status label, mirroring the Control Room "Building facility twin…" treatment so
 * pages show progress instead of sitting blank while their queries resolve.
 */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {label}
      </div>
    </div>
  );
}
