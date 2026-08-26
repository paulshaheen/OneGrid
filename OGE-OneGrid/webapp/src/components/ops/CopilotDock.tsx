import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Maximize2,
  Minimize2,
  Plus,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";

import { OpsMap } from "@/components/ops/OpsMap";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { getServices } from "@/lib/services";
import { cn } from "@/lib/utils";

// OneGrid Copilot — the single operations assistant for the whole app. Lives bottom-right
// on every page ("Ask the data"), and expands full-screen with a live map that highlights
// referenced assets. Answers span BOTH intelligence domains: weather / asset-risk questions
// go to the copilot service (grounded in the map + forecast + risk model), while digital-twin
// questions (equipment health, anomalies, predicted trips) are answered from the twin model.

const MODELS: Record<string, string[]> = {
  "Azure OpenAI": ["GPT-5", "GPT-4o", "GPT-4o mini"],
  Anthropic: ["Claude Opus 4", "Claude Sonnet 4"],
  Meta: ["Llama 3.1 70B"],
};
const INTRO =
  "Ask across the whole grid — storm exposure, asset risk, digital-twin telemetry, or the ontology.";

type Msg = { who: "ai" | "me"; text: string; citations?: string[]; highlightIds?: string[] };

type TwinSummary = {
  healthAvg: number;
  critNames: string[];
  trips: number;
  tripText: string;
  briefing: { asset: string; headline: string }[];
};

const TWIN_RE =
  /turbine|boiler|pump|generator|equipment|digital twin|\btwin\b|anomal|\btrip|vibration|bearing|fleet health|rv3|rv4|riverton|fairview|deepwater|harbor point|cedar falls|ashford|maintenance|work order/i;

function twinAnswer(q: string, tw: TwinSummary): Msg {
  if (/\btrip|survival|predict/i.test(q)) {
    return {
      who: "ai",
      text: `The survival model flags ${tw.trips} equipment asset${tw.trips === 1 ? "" : "s"} likely to trip within 14 days${tw.tripText ? `: ${tw.tripText}` : "."}.`,
      citations: ["predictions_longterm", "predictions_shortterm", "aakr_health"],
    };
  }
  if (/anomal/i.test(q)) {
    const b = tw.briefing[0];
    return {
      who: "ai",
      text: b
        ? `Top digital-twin anomaly: ${b.asset} — ${b.headline}`
        : "No active anomalies on the fleet.",
      citations: ["anomaly_advisories", "root_cause"],
    };
  }
  return {
    who: "ai",
    text: `Digital twin — fleet health ${tw.healthAvg}%. Critical equipment: ${tw.critNames.join(", ") || "none"}. ${tw.trips} predicted trip${tw.trips === 1 ? "" : "s"} over the next 14 days. Open the Control Room for the live 3D twin.`,
    citations: ["aakr_health", "predictions_longterm", "dim_asset"],
  };
}

export function CopilotDock({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const base = useOpsBase();
  const { assets, riskMap, event } = useOpsSnapshot(base, 120);

  const [expanded, setExpanded] = useState(false);
  const [model, setModel] = useState("GPT-5");
  const [modelMenu, setModelMenu] = useState(false);
  const [provider, setProvider] = useState<"azure" | "copilot">("azure");
  const [agent, setAgent] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([{ who: "ai", text: INTRO }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const twinRef = useRef<TwinSummary | null>(null);

  // Cross-domain suggestions: two weather/asset, two digital-twin.
  const suggestions = useMemo(() => {
    const svc = getServices(base).copilot.suggestions();
    return [
      ...svc.slice(0, 2),
      "Which equipment will trip in 14 days?",
      "Show the top twin anomaly",
    ];
  }, [base]);

  useEffect(() => {
    let ok = true;
    import("@/report/lib/sample.js").then((m) => {
      if (!ok) return;
      const fa = m.fleetAssets();
      const pd = m.predictionsDetail();
      const nar = m.narrative();
      const tripRows = pd.rows.filter((r) => (r.surv14 ?? 1) < 0.6).slice(0, 5);
      twinRef.current = {
        healthAvg: Math.round(m.fleetHealth().health.avg),
        critNames: fa.filter((a) => a.status === "critical").map((a) => `${a.unit} ${a.name}`),
        trips: tripRows.length,
        tripText: tripRows
          .map((r) => `${r.unit} ${r.name} (${Math.round((r.surv14 ?? 0) * 100)}% 14-day survival)`)
          .join(", "),
        briefing: (nar.briefing ?? []).slice(0, 4),
      };
    });
    return () => {
      ok = false;
    };
  }, []);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [messages, open, expanded]);

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    setMessages((m) => [...m, { who: "me", text: t }]);
    setBusy(true);
    let ai: Msg;
    if (TWIN_RE.test(t) && twinRef.current) {
      ai = twinAnswer(t, twinRef.current);
    } else {
      const a = await getServices(base).copilot.ask(t);
      ai = {
        who: "ai",
        text: a.text,
        citations: a.citations.map((c) => c.label),
        highlightIds: a.highlightAssetIds,
      };
    }
    setMessages((m) => [...m, ai]);
    if (ai.highlightIds && ai.highlightIds.length) setHighlight(ai.highlightIds);
    setBusy(false);
  };
  const reset = () => {
    setMessages([{ who: "ai", text: INTRO }]);
    setHighlight([]);
  };

  const lastIsAi = messages[messages.length - 1]?.who === "ai";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-6 bottom-6 z-50 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-2xl"
        style={{
          background: "linear-gradient(135deg, var(--color-primary), oklch(0.62 0.13 249))",
        }}
      >
        <Sparkles className="size-4" /> Ask the data
      </button>
    );
  }

  const header = (
    <div className="flex flex-col gap-2 border-b p-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Sparkles className="size-4 text-primary" /> OneGrid Copilot
        </div>
        <div className="relative ml-auto">
          <button
            onClick={() => setModelMenu((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border bg-surface-raised px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {model} <ChevronDown className="size-3" />
          </button>
          {modelMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setModelMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border bg-card p-1.5 shadow-xl">
                {Object.entries(MODELS).map(([vendor, list]) => (
                  <div key={vendor}>
                    <div className="px-2 pt-1.5 pb-1 text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
                      {vendor}
                    </div>
                    {list.map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setModel(m);
                          setModelMenu(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent"
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full border",
                            m === model ? "border-primary bg-primary" : "border-border",
                          )}
                        />
                        {m}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={expanded ? "Restore" : "Expand full screen"}
          title={expanded ? "Restore" : "Expand full screen"}
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded-md border">
          {(["azure", "copilot"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-semibold capitalize",
                provider === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </span>
        <button
          onClick={() => setAgent((a) => !a)}
          title="Answer from the published Fabric Data Agent, grounded in the OneGrid semantic model"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
            agent ? "border-primary/50 text-foreground" : "text-muted-foreground",
          )}
        >
          <Bot className="size-3.5" /> Data Agent
          <span
            className={cn("size-1.5 rounded-full", agent ? "bg-primary" : "bg-muted-foreground/40")}
          />
        </button>
        <button
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> New
        </button>
      </div>
    </div>
  );

  const thread = (
    <div ref={msgsRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
      {messages.map((m, i) => (
        <div
          key={i}
          className={cn(
            "flex max-w-[86%] flex-col gap-1",
            m.who === "ai" ? "self-start" : "self-end",
          )}
        >
          <div
            className={cn(
              "rounded-xl px-3 py-2 text-[13px] leading-relaxed",
              m.who === "ai" ? "bg-surface-raised" : "bg-primary/20",
            )}
          >
            {m.text}
          </div>
          {m.citations && m.citations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {m.citations.map((c, j) => (
                <span
                  key={j}
                  className="rounded-sm border bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {expanded && m.highlightIds && m.highlightIds.length > 0 && (
            <button
              onClick={() => setHighlight(m.highlightIds!)}
              className="self-start text-[11px] text-primary hover:underline"
            >
              Highlight {m.highlightIds.length} assets on the map
            </button>
          )}
        </div>
      ))}
      {lastIsAi && !busy && (
        <div className="flex flex-wrap gap-1.5 self-start">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <div className="self-start text-[12px] text-muted-foreground">
          Analyzing forecast, asset exposure and twin telemetry…
        </div>
      )}
    </div>
  );

  const inputBar = (
    <>
      <div className="flex gap-2 border-t p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about any asset, storm, equipment, model or the ontology…"
          className="flex-1 rounded-lg border bg-surface-raised px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
        />
        <button
          onClick={() => send()}
          className="grid place-items-center rounded-lg bg-primary px-3 text-primary-foreground"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
      <div className="pb-2 text-center text-[9px] text-muted-foreground">
        Grounded in Eventhouse (KQL) · semantic model (DAX) · digital twin · forecast
      </div>
    </>
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-card">
        {header}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div className="flex min-h-0 flex-col border-r">
            {thread}
            {inputBar}
          </div>
          <div className="relative hidden min-h-0 lg:block">
            <OpsMap
              className="h-full w-full"
              assets={assets}
              risks={riskMap}
              event={event}
              layers={{ assets: true, track: true, wind: true }}
              highlightIds={highlight}
              selectedId={selected}
              onSelect={setSelected}
            />
            <div className="pointer-events-none absolute top-3 left-3 rounded-md border bg-card/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
              Referenced assets highlight here
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed right-6 bottom-6 z-50 flex max-h-[74vh] w-96 flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
      {header}
      {thread}
      {inputBar}
    </div>
  );
}
