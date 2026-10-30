import type { RiskRow } from "@/lib/exec/exec-brief";

/** What the executive "evidence" pop-up is about. */
export type EvidenceSubject =
  | { kind: "equipment"; assetId: string; site: string; item: string; pct?: number | null }
  | { kind: "weather"; row: RiskRow }
  | { kind: "work" };

export function subjectFromRow(row: RiskRow): EvidenceSubject {
  return row.kind === "weather"
    ? { kind: "weather", row }
    : {
        kind: "equipment",
        assetId: row.assetId ?? "",
        site: row.site,
        item: row.item,
        pct: row.pct,
      };
}

/** /api/asset returns root cause as a list of rows; callers want the first one. */
export function firstRootCause<T>(rc: T | T[] | null | undefined): T | null {
  return (Array.isArray(rc) ? rc[0] : rc) ?? null;
}
