import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Plus, Send, Sparkles, X } from "lucide-react";

import { useOpsBase } from "@/components/ops/ops-nav";
import { getServices } from "@/lib/services";
import { cn } from "@/lib/utils";

// OneGrid Copilot — a single full-height right-side assistant, styled to the OneGrid app
// (deep-navy, Azure accent) rather than the weather console. Answers span BOTH domains:
// weather / asset-risk questions go to the copilot service (with citations); digital-twin
// questions (equipment health, anomalies, predicted trips) are answered from the twin model.

// OneGrid palette (independent of the weather console's shadcn tokens).
const OG = {
  bg: "#0b1220",
  panel: "#0f1522",
  raised: "#141c2c",
  border: "rgba(120,160,255,.16)",
  heading: "#f5f8fd",
  sub: "#7d89a1",
  accent: "#3f96ff",
};

const MODELS: Record<string, string[]> = {
  "Azure OpenAI": ["GPT-5", "GPT-4o", "GPT-4o mini"],
  Anthropic: ["Claude Opus 4", "Claude Sonnet 4"],
  Meta: ["Llama 3.1 70B"],
};
const INTRO =
  "Ask across the whole grid — storm exposure, asset risk, digital-twin telemetry, or the ontology.";

type Msg = { who: "ai" | "me"; text: string; citations?: string[] };

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

  const [model, setModel] = useState("GPT-5");
  const [modelMenu, setModelMenu] = useState(false);
  const [provider, setProvider] = useState<"azure" | "copilot">("azure");
  const [agent, setAgent] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([{ who: "ai", text: INTRO }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const twinRef = useRef<TwinSummary | null>(null);

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
  }, [messages, open]);

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
      ai = { who: "ai", text: a.text, citations: a.citations.map((c) => c.label) };
    }
    setMessages((m) => [...m, ai]);
    setBusy(false);
  };
  const reset = () => setMessages([{ who: "ai", text: INTRO }]);
  const lastIsAi = messages[messages.length - 1]?.who === "ai";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-6 bottom-6 z-50 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-2xl"
        style={{ background: `linear-gradient(135deg, ${OG.accent}, #2f6fd0)` }}
      >
        <Sparkles className="size-4" /> Ask the data
      </button>
    );
  }

  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l shadow-2xl"
      style={{ background: OG.bg, borderColor: OG.border }}
    >
      {/* header */}
      <div className="flex flex-col gap-2 border-b p-3" style={{ borderColor: OG.border }}>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 text-[13px] font-semibold"
            style={{ color: OG.heading }}
          >
            <Sparkles className="size-4" style={{ color: OG.accent }} /> OneGrid Copilot
          </div>
          <div className="relative ml-auto">
            <button
              onClick={() => setModelMenu((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
              style={{ borderColor: OG.border, background: OG.raised, color: OG.sub }}
            >
              {model} <ChevronDown className="size-3" />
            </button>
            {modelMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setModelMenu(false)} />
                <div
                  className="absolute right-0 z-20 mt-1 w-56 rounded-lg border p-1.5 shadow-xl"
                  style={{ background: OG.panel, borderColor: OG.border }}
                >
                  {Object.entries(MODELS).map(([vendor, list]) => (
                    <div key={vendor}>
                      <div
                        className="px-2 pt-1.5 pb-1 text-[9px] font-medium tracking-wider uppercase"
                        style={{ color: OG.sub }}
                      >
                        {vendor}
                      </div>
                      {list.map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setModel(m);
                            setModelMenu(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                          style={{ color: OG.heading }}
                        >
                          <span
                            className="size-1.5 rounded-full border"
                            style={{
                              borderColor: m === model ? OG.accent : OG.border,
                              background: m === model ? OG.accent : "transparent",
                            }}
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
            onClick={() => setOpen(false)}
            className="rounded-md p-1 hover:bg-white/5"
            style={{ color: OG.sub }}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex overflow-hidden rounded-md border"
            style={{ borderColor: OG.border }}
          >
            {(["azure", "copilot"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className="px-2.5 py-1 text-[11px] font-semibold capitalize"
                style={
                  provider === p ? { background: OG.accent, color: "#06121f" } : { color: OG.sub }
                }
              >
                {p}
              </button>
            ))}
          </span>
          <button
            onClick={() => setAgent((a) => !a)}
            title="Answer from the published Fabric Data Agent, grounded in the OneGrid semantic model"
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
            style={{
              borderColor: agent ? `${OG.accent}80` : OG.border,
              color: agent ? OG.heading : OG.sub,
            }}
          >
            <Bot className="size-3.5" /> Data Agent
            <span
              className="size-1.5 rounded-full"
              style={{ background: agent ? OG.accent : OG.sub }}
            />
          </button>
          <button
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
            style={{ borderColor: OG.border, color: OG.sub }}
          >
            <Plus className="size-3" /> New
          </button>
        </div>
      </div>

      {/* thread */}
      <div ref={msgsRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex max-w-[88%] flex-col gap-1",
              m.who === "ai" ? "self-start" : "self-end",
            )}
          >
            <div
              className="rounded-xl px-3 py-2 text-[13px] leading-relaxed"
              style={
                m.who === "ai"
                  ? { background: OG.raised, color: OG.heading }
                  : { background: `${OG.accent}26`, color: OG.heading }
              }
            >
              {m.text}
            </div>
            {m.citations && m.citations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {m.citations.map((c, j) => (
                  <span
                    key={j}
                    className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
                    style={{ borderColor: OG.border, color: OG.sub }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {lastIsAi && !busy && (
          <div className="flex flex-wrap gap-1.5 self-start">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border px-2.5 py-1 text-[11.5px]"
                style={{ borderColor: OG.border, color: OG.sub }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {busy && (
          <div className="self-start text-[12px]" style={{ color: OG.sub }}>
            Analyzing forecast, asset exposure and twin telemetry…
          </div>
        )}
      </div>

      {/* input */}
      <div className="flex gap-2 border-t p-2.5" style={{ borderColor: OG.border }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about any asset, storm, equipment, model or the ontology…"
          className="flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ background: OG.raised, borderColor: OG.border, color: OG.heading }}
        />
        <button
          onClick={() => send()}
          className="grid place-items-center rounded-lg px-3"
          style={{ background: OG.accent, color: "#06121f" }}
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
      <div className="pb-2 text-center text-[9px]" style={{ color: OG.sub }}>
        Grounded in Eventhouse (KQL) · semantic model (DAX) · digital twin · forecast
      </div>
    </div>
  );
}
