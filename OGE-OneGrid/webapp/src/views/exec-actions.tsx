// "Actions" layout of the executive brief: just the list of what to do this week and the
// value at stake for each. Same data as the dashboard layout, so the two always agree.
// Clicking an action opens a plain-language analysis pop-up.
import { ArrowRight, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

import { OpsLink } from "@/components/ops/ops-nav";
import {
  formatUsd,
  type Action,
  type ExecBrief,
  type RiskLevel3,
  type RiskRow,
} from "@/lib/exec/exec-brief";
import type { Solution } from "@/lib/solution";
import { cn } from "@/lib/utils";
import { ActionModal } from "@/views/exec-action-modal";

const NUMBER: Record<RiskLevel3 | "none", string> = {
  critical: "bg-red-500/12 text-red-500 ring-red-500/30",
  high: "bg-amber-500/12 text-amber-500 ring-amber-500/30",
  watch: "bg-sky-500/12 text-sky-500 ring-sky-500/30",
  none: "bg-primary/10 text-primary ring-primary/25",
};

interface Item {
  key: string;
  level: RiskLevel3 | "none";
  action: Action;
  usd: number | null;
  row: RiskRow | null;
}

export function ExecActions({
  brief,
  brandName,
  solution,
  onAsk,
}: {
  brief: ExecBrief;
  brandName: string;
  solution: Solution;
  onAsk: (question: string) => void;
}) {
  const items: Item[] = [
    ...brief.risks.map((r) => ({
      key: r.key,
      level: r.level as RiskLevel3 | "none",
      action: r.action,
      usd: r.usd,
      row: r,
    })),
    ...(brief.followUp
      ? [{ key: "follow-up", level: "none" as const, action: brief.followUp, usd: null, row: null }]
      : []),
  ];
  const total = items.reduce((s, i) => s + (i.usd ?? 0), 0);
  const [open, setOpen] = useState<number | null>(null);
  const openItem = open != null ? items[open] : undefined;

  return (
    <section className="mx-auto w-full max-w-3xl pt-2">
      <div className="rounded-2xl border bg-card/80 shadow-sm shadow-black/5 dark:shadow-black/30">
        <div className="flex items-end justify-between gap-6 border-b px-6 py-5">
          <div>
            <div className="text-xs font-medium text-muted-foreground">This week</div>
            <div className="text-lg font-semibold leading-7">
              {items.length
                ? `${items.length} ${items.length === 1 ? "action" : "actions"}`
                : "Nothing to do"}
            </div>
          </div>
          {total > 0 && (
            <div className="text-right">
              <div className="text-xs font-medium text-muted-foreground">Value at stake</div>
              <div className="text-2xl font-semibold tabular-nums leading-8 text-emerald-500">
                ~{formatUsd(total)}
              </div>
            </div>
          )}
        </div>

        {items.length ? (
          <ol className="divide-y">
            {items.map((item, i) => (
              <li
                key={item.key}
                onClick={() => setOpen(i)}
                className="group flex cursor-pointer items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/40"
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1 ring-inset",
                    NUMBER[item.level],
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(i);
                    }}
                    className="block max-w-full truncate text-left text-[15px] font-semibold leading-6 group-hover:text-primary"
                  >
                    {item.action.title}
                  </button>
                  <div className="truncate text-sm text-muted-foreground">
                    {item.action.owner} · {item.action.due}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAsk(item.action.question);
                      }}
                      className="ml-2 inline-flex items-center gap-1 font-medium text-primary opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100"
                    >
                      <Sparkles className="size-3.5" /> Why?
                    </button>
                  </div>
                </div>
                <div className="w-28 shrink-0 text-right">
                  {item.usd ? (
                    <>
                      <div className="text-lg font-semibold tabular-nums leading-6">
                        ~{formatUsd(item.usd)}
                      </div>
                      <div className="text-xs text-muted-foreground">at stake</div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{item.action.benefit}</div>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-6 py-8 text-center text-muted-foreground">
            {brief.dataGaps.length
              ? "Some data could not be loaded, so this list may be incomplete."
              : "No decisions are needed this week."}
          </p>
        )}
      </div>
      <p className="mt-3 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
        Click an action for the simple explanation · Values are {brandName} model estimates (typical
        outcome) ·
        <OpsLink
          to="/"
          className="inline-flex items-center gap-0.5 font-medium text-foreground hover:underline"
        >
          Open Operations <ArrowRight className="size-3" />
        </OpsLink>
      </p>

      {openItem && open != null && (
        <ActionModal
          action={openItem.action}
          row={openItem.row}
          brief={brief}
          solution={solution}
          number={open + 1}
          onAsk={onAsk}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
