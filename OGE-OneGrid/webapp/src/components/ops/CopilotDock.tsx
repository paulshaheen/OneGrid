import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  Github,
  Loader2,
  Plus,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

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

const INTRO =
  "Ask across the whole grid — storm exposure, asset risk, digital-twin telemetry, or the ontology.";

// A chat model the backend actually exposes (from /api/models), per active provider.
type ModelInfo = { id: string; name: string; vendor: string };

// Persona lenses (mirror the report-app chat personas) — steer tone/focus.
const PERSONAS: { id: string; label: string }[] = [
  { id: "controlroom", label: "Control Room" },
  { id: "executive", label: "Executive" },
  { id: "maintenance", label: "Maintenance" },
];

// Rich Markdown renderer for assistant answers — real GFM parsing (headings,
// bold, lists, tables, code, links, rules, blockquotes) styled to the dark theme.
const MD_COMPONENTS = {
  h1: (p: { children?: React.ReactNode }) => (
    <div style={{ fontWeight: 700, fontSize: 15, margin: "10px 0 4px", color: OG.heading }}>{p.children}</div>
  ),
  h2: (p: { children?: React.ReactNode }) => (
    <div style={{ fontWeight: 700, fontSize: 14, margin: "10px 0 4px", color: OG.heading }}>{p.children}</div>
  ),
  h3: (p: { children?: React.ReactNode }) => (
    <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 3px", color: OG.heading }}>{p.children}</div>
  ),
  h4: (p: { children?: React.ReactNode }) => (
    <div style={{ fontWeight: 600, fontSize: 12.5, margin: "6px 0 2px", color: OG.sub }}>{p.children}</div>
  ),
  p: (p: { children?: React.ReactNode }) => <p style={{ margin: "5px 0" }}>{p.children}</p>,
  ul: (p: { children?: React.ReactNode }) => (
    <ul style={{ listStyle: "disc", paddingLeft: 18, margin: "4px 0" }}>{p.children}</ul>
  ),
  ol: (p: { children?: React.ReactNode }) => (
    <ol style={{ listStyle: "decimal", paddingLeft: 18, margin: "4px 0" }}>{p.children}</ol>
  ),
  li: (p: { children?: React.ReactNode }) => <li style={{ margin: "2px 0" }}>{p.children}</li>,
  strong: (p: { children?: React.ReactNode }) => (
    <strong style={{ fontWeight: 700, color: OG.heading }}>{p.children}</strong>
  ),
  em: (p: { children?: React.ReactNode }) => <em style={{ fontStyle: "italic" }}>{p.children}</em>,
  a: (p: { href?: string; children?: React.ReactNode }) => (
    <a href={p.href} target="_blank" rel="noreferrer" style={{ color: OG.accent, textDecoration: "underline" }}>
      {p.children}
    </a>
  ),
  hr: () => <hr style={{ border: "none", borderTop: `1px solid ${OG.border}`, margin: "10px 0" }} />,
  blockquote: (p: { children?: React.ReactNode }) => (
    <blockquote style={{ borderLeft: `3px solid ${OG.border}`, paddingLeft: 10, margin: "6px 0", color: OG.sub }}>
      {p.children}
    </blockquote>
  ),
  code: (p: { inline?: boolean; children?: React.ReactNode }) =>
    p.inline ? (
      <code style={{ padding: "0 4px", borderRadius: 4, background: "rgba(120,160,255,.16)", fontSize: 11.5, fontFamily: "ui-monospace, monospace" }}>
        {p.children}
      </code>
    ) : (
      <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{p.children}</code>
    ),
  pre: (p: { children?: React.ReactNode }) => (
    <pre
      style={{
        overflowX: "auto",
        background: OG.bg,
        border: `1px solid ${OG.border}`,
        borderRadius: 8,
        padding: 10,
        margin: "8px 0",
        color: "#cfe0ff",
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {p.children}
    </pre>
  ),
  table: (p: { children?: React.ReactNode }) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5, lineHeight: 1.45 }}>
        {p.children}
      </table>
    </div>
  ),
  th: (p: { children?: React.ReactNode }) => (
    <th
      style={{
        textAlign: "left",
        padding: "5px 8px",
        borderBottom: "1px solid rgba(120,160,255,.28)",
        fontWeight: 600,
        color: "#eaf1fb",
        whiteSpace: "nowrap",
      }}
    >
      {p.children}
    </th>
  ),
  td: (p: { children?: React.ReactNode }) => (
    <td style={{ padding: "5px 8px", borderBottom: "1px solid rgba(120,160,255,.10)", verticalAlign: "top", color: "#cdd8e6" }}>
      {p.children}
    </td>
  ),
};

function Markdown({ children }: { children: string }) {
  return (
    <div className="og-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

type Msg = {
  who: "ai" | "me";
  text: string;
  citations?: string[];
  evidence?: { label: string; detail: string }[];
  reasoning?: string;
  context?: string;
};

// Split a trailing "### How I reasoned" section out of the answer so it can be
// shown in the collapsible "Thought process" panel instead of the main bubble.
function splitReasoning(text: string): { answer: string; reasoning?: string } {
  const m = text.match(/\n#{2,4}\s*How I reasoned\s*\n?([\s\S]*)$/i);
  if (m && m.index != null) return { answer: text.slice(0, m.index).trim(), reasoning: m[1].trim() };
  const b = text.match(/\n\*\*How I reasoned\*\*:?\s*\n?([\s\S]*)$/i);
  if (b && b.index != null) return { answer: text.slice(0, b.index).trim(), reasoning: b[1].trim() };
  return { answer: text };
}

type TwinSummary = {
  healthAvg: number;
  critNames: string[];
  trips: number;
  tripText: string;
  briefing: { asset: string; headline: string }[];
};

// Collapsible "Thought process": the evidence (data + counts) the answer was
// grounded on, the model's short reasoning trace, and a raw-data expander.
function ThoughtProcess({ msg }: { msg: Msg }) {
  const [open, setOpen] = useState(false);
  const [showData, setShowData] = useState(false);
  const hasEvidence = !!(msg.evidence && msg.evidence.length);
  if (!hasEvidence && !msg.reasoning && !msg.context) return null;
  return (
    <div className="rounded-md border text-[11.5px]" style={{ borderColor: OG.border, background: OG.bg }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
        style={{ color: OG.sub }}
      >
        <Sparkles className="size-3.5" style={{ color: OG.accent }} />
        <span className="font-medium">Thought process</span>
        <ChevronDown className={cn("ml-auto size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 px-2.5 pb-2.5">
          {hasEvidence && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: OG.sub }}>
                Data reviewed
              </div>
              <div className="space-y-0.5">
                {msg.evidence!.map((e, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3">
                    <span style={{ color: OG.heading }}>{e.label}</span>
                    <span className="text-right tabular-nums" style={{ color: OG.sub }}>{e.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {msg.reasoning && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: OG.sub }}>
                How I reasoned
              </div>
              <div style={{ color: OG.heading }}>
                <Markdown>{msg.reasoning}</Markdown>
              </div>
            </div>
          )}
          {msg.context && (
            <div>
              <button
                onClick={() => setShowData((s) => !s)}
                className="text-[11px] underline"
                style={{ color: OG.accent }}
              >
                {showData ? "Hide" : "View"} the exact data sent to the model
              </button>
              {showData && (
                <pre
                  className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded p-2 text-[10.5px] leading-relaxed"
                  style={{ background: OG.panel, color: "#9fb4d8" }}
                >
                  {msg.context}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelMenu, setModelMenu] = useState(false);
  const [provider, setProvider] = useState<"azure" | "copilot">("azure");
  const [agent, setAgent] = useState(false);
  const [dataAgentAvailable, setDataAgentAvailable] = useState(false);
  const [persona, setPersona] = useState("controlroom");
  const [personaMenu, setPersonaMenu] = useState(false);
  const [stage, setStage] = useState(0);
  const stageTimer = useRef<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([{ who: "ai", text: INTRO }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const twinRef = useRef<TwinSummary | null>(null);

  // BYO GitHub Copilot license: a token (pasted or obtained via device flow),
  // persisted in the browser and forwarded only to power the user's own requests.
  const [copilotToken, setCopilotTokenState] = useState<string>(() => {
    try {
      return localStorage.getItem("og.copilot.token") || "";
    } catch {
      return "";
    }
  });
  const setCopilotToken = (t: string) => {
    const v = t.trim();
    setCopilotTokenState(v);
    try {
      if (v) localStorage.setItem("og.copilot.token", v);
      else localStorage.removeItem("og.copilot.token");
    } catch {
      /* ignore */
    }
  };
  const [connectOpen, setConnectOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceErr, setDeviceErr] = useState("");
  const pollRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    },
    [],
  );

  const startDeviceLogin = async () => {
    setDeviceErr("");
    setDeviceBusy(true);
    setDevice(null);
    try {
      const r = await getServices(base).copilot.startGithubLogin();
      if (!r.ok || !r.deviceCode) {
        setDeviceErr(r.error || "Could not start GitHub sign-in.");
        setDeviceBusy(false);
        return;
      }
      setDevice({
        userCode: r.userCode || "",
        verificationUri: r.verificationUri || "https://github.com/login/device",
      });
      const interval = Math.max(5, r.interval || 5) * 1000;
      const deviceCode = r.deviceCode;
      const expiresAt = Date.now() + (r.expiresIn || 900) * 1000;
      const poll = async () => {
        if (Date.now() > expiresAt) {
          setDeviceErr("Sign-in expired — try again.");
          setDeviceBusy(false);
          return;
        }
        try {
          const p = await getServices(base).copilot.pollGithubLogin(deviceCode);
          if (p.status === "ok" && p.token) {
            setCopilotToken(p.token);
            setDevice(null);
            setDeviceBusy(false);
            setConnectOpen(false);
            return;
          }
          if (p.status === "error") {
            setDeviceErr(p.error || "Sign-in failed.");
            setDeviceBusy(false);
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        pollRef.current = window.setTimeout(poll, interval);
      };
      pollRef.current = window.setTimeout(poll, interval);
    } catch {
      setDeviceErr("Could not reach the server.");
      setDeviceBusy(false);
    }
  };
  const disconnectCopilot = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    setCopilotToken("");
    setDevice(null);
    setDeviceErr("");
    setDeviceBusy(false);
  };

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

  // Only surface the "Data Agent" toggle when the Fabric Data Agent is actually
  // configured for this deployment — otherwise it's a dead control.
  useEffect(() => {
    let ok = true;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : { dataAgent: false }))
      .then((h: { dataAgent?: boolean }) => {
        if (ok) setDataAgentAvailable(!!h.dataAgent);
      })
      .catch(() => {
        if (ok) setDataAgentAvailable(false);
      });
    return () => {
      ok = false;
    };
  }, []);

  // Load the models the backend ACTUALLY exposes for the active provider (Azure
  // Foundry deployments, or the user's GitHub Copilot models). Replaces a stale
  // hardcoded list so the selector only offers models that really work.
  useEffect(() => {
    // Don't probe Copilot models until a license token is connected.
    if (provider === "copilot" && !copilotToken.trim()) {
      setModels([]);
      return;
    }
    let ok = true;
    const prov = provider === "copilot" ? "copilot" : "foundry";
    const headers: Record<string, string> = {};
    if (provider === "copilot" && copilotToken.trim()) headers["x-copilot-token"] = copilotToken.trim();
    fetch(`/api/models?provider=${prov}`, { headers })
      .then((r) => (r.ok ? r.json() : { models: [], default: "" }))
      .then((d: { models?: ModelInfo[]; default?: string }) => {
        if (!ok) return;
        const list = Array.isArray(d.models) ? d.models : [];
        setModels(list);
        setModel((prev) =>
          list.some((m) => m.id === prev) ? prev : d.default || list[0]?.id || "",
        );
      })
      .catch(() => {
        if (ok) setModels([]);
      });
    return () => {
      ok = false;
    };
  }, [provider, copilotToken]);

  const currentModel = models.find((m) => m.id === model);
  const modelsByVendor = useMemo(() => {
    const g: Record<string, ModelInfo[]> = {};
    for (const m of models) (g[m.vendor || "Other"] ||= []).push(m);
    return g;
  }, [models]);

  const useDataAgent = agent && dataAgentAvailable;
  // Live status steps shown while the assistant works (the real stages of a
  // grounded answer). The Data Agent path streams its own status text.
  const STAGES = useDataAgent
    ? ["Querying the Fabric Data Agent…"]
    : ["Gathering live data — weather, exposure, outages, work orders…", `Asking ${currentModel?.name || "the model"}…`];
  const [agentStatus, setAgentStatus] = useState("");

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    // BYO Copilot selected but not connected → prompt to connect instead of sending.
    if (provider === "copilot" && !copilotToken.trim()) {
      setConnectOpen(true);
      return;
    }
    setInput("");
    setMessages((m) => [...m, { who: "me", text: t }]);
    setBusy(true);
    setStage(0);
    setAgentStatus("");
    if (stageTimer.current) window.clearTimeout(stageTimer.current);
    // Advance to the "asking the model" step shortly after grounding kicks off.
    if (!useDataAgent) stageTimer.current = window.setTimeout(() => setStage(1), 900);
    let ai: Msg;
    if (/manual|how\s+(?:do|to)\b.*(?:fix|resolv)|resolve work order/i.test(t)) {
      // Ground "how to fix" questions in the Foundry-IQ equipment manuals.
      try {
        const r = await fetch(`/api/manuals/search?q=${encodeURIComponent(t)}&top=1`).then((res) =>
          res.json(),
        );
        const p = r?.results?.[0];
        ai = p
          ? {
              who: "ai",
              text: `From ${p.title} — ${p.section}:\n\n${p.snippet}`,
              citations: [`${p.manual_id} · ${p.section}`],
            }
          : { who: "ai", text: "I couldn't find a matching passage in the equipment manuals." };
      } catch {
        ai = { who: "ai", text: "The equipment manuals aren't available right now." };
      }
    } else if (TWIN_RE.test(t) && twinRef.current) {
      ai = twinAnswer(t, twinRef.current);
    } else if (useDataAgent) {
      // Route to the published Fabric Data Agent (SSE: status updates + final reply).
      ai = { who: "ai", text: "" };
      try {
        const resp = await fetch("/api/ask-ontology", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: t }),
        });
        const reader = resp.body?.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let reply = "";
        while (reader) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() || "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === "status") setAgentStatus(String(d.status ?? ""));
              else if (d.type === "done") reply = String(d.reply ?? "");
            } catch {
              /* skip non-JSON frame */
            }
          }
        }
        ai = { who: "ai", text: reply || "No answer was returned by the Data Agent.", citations: ["Fabric Data Agent"] };
      } catch {
        ai = { who: "ai", text: "The Fabric Data Agent is unavailable right now." };
      }
    } else {
      const a = await getServices(base).copilot.ask(t, {
        model: model || undefined,
        persona,
        copilotToken: provider === "copilot" ? copilotToken : undefined,
      });
      const { answer, reasoning } = splitReasoning(a.text);
      ai = {
        who: "ai",
        text: answer,
        citations: a.citations.map((c) => c.label),
        evidence: a.evidence,
        reasoning,
        context: a.context,
      };
    }
    if (stageTimer.current) window.clearTimeout(stageTimer.current);
    setMessages((m) => [...m, ai]);
    setBusy(false);
    setAgentStatus("");
  };
  const reset = () => setMessages([{ who: "ai", text: INTRO }]);
  const lastIsAi = messages[messages.length - 1]?.who === "ai";

  // Bridge external "ask" events to the dock: open it and (if a message is supplied)
  // send it. Handles the ops `onegrid-ask` (plain open) and the report/manuals
  // `pm-chat-ask` / `pm-chat-open` events (e.g. the manual "Ask AI to solve" button),
  // which previously went unhandled here so the modal just closed.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true);
      const msg = (e as CustomEvent).detail?.message;
      if (typeof msg === "string" && msg.trim()) setTimeout(() => sendRef.current(msg), 60);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("onegrid-ask", onAsk);
    window.addEventListener("pm-chat-ask", onAsk);
    window.addEventListener("pm-chat-open", onOpen);
    return () => {
      window.removeEventListener("onegrid-ask", onAsk);
      window.removeEventListener("pm-chat-ask", onAsk);
      window.removeEventListener("pm-chat-open", onOpen);
    };
  }, [setOpen]);

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
              disabled={models.length === 0}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-60"
              style={{ borderColor: OG.border, background: OG.raised, color: OG.sub }}
              title={
                provider === "copilot" && !copilotToken.trim()
                  ? "Connect a GitHub Copilot license to choose a model"
                  : "Switch AI model"
              }
            >
              {currentModel?.name || model || (models.length ? "Model" : "No models")}{" "}
              <ChevronDown className="size-3" />
            </button>
            {modelMenu && models.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setModelMenu(false)} />
                <div
                  className="absolute right-0 z-20 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-lg border p-1.5 shadow-xl"
                  style={{ background: OG.panel, borderColor: OG.border }}
                >
                  {Object.entries(modelsByVendor).map(([vendor, list]) => (
                    <div key={vendor}>
                      <div
                        className="px-2 pt-1.5 pb-1 text-[9px] font-medium tracking-wider uppercase"
                        style={{ color: OG.sub }}
                      >
                        {vendor}
                      </div>
                      {list.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setModelMenu(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                          style={{ color: OG.heading }}
                        >
                          <span
                            className="size-1.5 rounded-full border"
                            style={{
                              borderColor: m.id === model ? OG.accent : OG.border,
                              background: m.id === model ? OG.accent : "transparent",
                            }}
                          />
                          {m.name}
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
                onClick={() => {
                  setProvider(p);
                  if (p === "copilot" && !copilotToken.trim()) setConnectOpen(true);
                }}
                className="px-2.5 py-1 text-[11px] font-semibold capitalize"
                style={
                  provider === p ? { background: OG.accent, color: "#06121f" } : { color: OG.sub }
                }
              >
                {p}
              </button>
            ))}
          </span>
          {/* Persona lens — steers tone/focus of the answer */}
          <div className="relative">
            <button
              onClick={() => setPersonaMenu((o) => !o)}
              title="Answer persona"
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
              style={{ borderColor: OG.border, color: OG.sub }}
            >
              <UserRound className="size-3.5" />
              {PERSONAS.find((x) => x.id === persona)?.label ?? "Persona"}
              <ChevronDown className="size-3" />
            </button>
            {personaMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPersonaMenu(false)} />
                <div
                  className="absolute left-0 z-20 mt-1 w-44 rounded-lg border p-1 shadow-xl"
                  style={{ background: OG.panel, borderColor: OG.border }}
                >
                  {PERSONAS.map((px) => (
                    <button
                      key={px.id}
                      onClick={() => {
                        setPersona(px.id);
                        setPersonaMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-white/5"
                      style={{ color: OG.heading }}
                    >
                      <span
                        className="size-1.5 rounded-full border"
                        style={{
                          borderColor: px.id === persona ? OG.accent : OG.border,
                          background: px.id === persona ? OG.accent : "transparent",
                        }}
                      />
                      {px.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {provider === "copilot" &&
            (copilotToken ? (
              <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: OG.sub }}>
                <Github className="size-3.5" style={{ color: OG.accent }} /> Copilot connected
                <button onClick={disconnectCopilot} className="underline hover:opacity-80">
                  disconnect
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConnectOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                style={{ borderColor: OG.border, color: OG.sub }}
              >
                <Github className="size-3.5" /> Connect license
              </button>
            ))}
          {dataAgentAvailable && (
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
          )}
          <button
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
            style={{ borderColor: OG.border, color: OG.sub }}
          >
            <Plus className="size-3" /> New
          </button>
        </div>
        {connectOpen && provider === "copilot" && !copilotToken && (
          <div
            className="mt-2 rounded-lg border p-2.5"
            style={{ borderColor: OG.border, background: OG.raised }}
          >
            <div className="text-[11px] leading-snug" style={{ color: OG.sub }}>
              Use your own GitHub Copilot license. Your token stays in this browser and is only
              forwarded to power your Copilot requests.
            </div>
            {device ? (
              <div
                className="mt-2 rounded-md border p-2"
                style={{ borderColor: OG.border, color: OG.heading }}
              >
                <div className="text-[11px]" style={{ color: OG.sub }}>
                  1) Open the link · 2) enter the code
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <code
                    className="rounded px-2 py-1 text-[15px] font-bold tracking-widest"
                    style={{ background: OG.bg, color: OG.accent }}
                  >
                    {device.userCode}
                  </code>
                  <a
                    href={device.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                    style={{ color: OG.accent }}
                  >
                    github.com/login/device <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="mt-1 text-[11px]" style={{ color: OG.sub }}>
                  Waiting for you to authorize…
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <button
                  onClick={startDeviceLogin}
                  disabled={deviceBusy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-60"
                  style={{ background: OG.accent, color: "#06121f" }}
                >
                  <Github className="size-3.5" /> {deviceBusy ? "Starting…" : "Sign in with GitHub"}
                </button>
                <div
                  className="flex items-center gap-2 text-[10px]"
                  style={{ color: OG.sub }}
                >
                  <span className="h-px flex-1" style={{ background: OG.border }} /> or paste a
                  token <span className="h-px flex-1" style={{ background: OG.border }} />
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="ghp_… / gho_…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tokenInput.trim()) {
                        setCopilotToken(tokenInput);
                        setTokenInput("");
                        setConnectOpen(false);
                      }
                    }}
                    className="flex-1 rounded-md border px-2 py-1 text-[12px] outline-none"
                    style={{ background: OG.bg, borderColor: OG.border, color: OG.heading }}
                  />
                  <button
                    onClick={() => {
                      if (tokenInput.trim()) {
                        setCopilotToken(tokenInput);
                        setTokenInput("");
                        setConnectOpen(false);
                      }
                    }}
                    className="rounded-md px-2.5 py-1 text-[12px] font-semibold"
                    style={{ background: OG.accent, color: "#06121f" }}
                  >
                    Use
                  </button>
                </div>
              </div>
            )}
            {deviceErr && (
              <div className="mt-1.5 text-[11px]" style={{ color: "#ff8080" }}>
                {deviceErr}
              </div>
            )}
          </div>
        )}
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
              {m.who === "ai" ? <Markdown>{m.text}</Markdown> : m.text}
            </div>
            {m.who === "ai" && <ThoughtProcess msg={m} />}
            {m.citations && m.citations.length > 0 && !(m.evidence && m.evidence.length) && (
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
          <div className="flex flex-col gap-1.5 self-start rounded-xl border px-3 py-2" style={{ borderColor: OG.border, background: OG.raised }}>
            {(useDataAgent && agentStatus ? [agentStatus] : STAGES).map((label, si) => {
              const active = useDataAgent ? true : si === stage;
              const doneStep = !useDataAgent && si < stage;
              return (
                <div key={si} className="flex items-center gap-2 text-[11.5px]" style={{ color: active ? OG.heading : OG.sub }}>
                  {active ? (
                    <Loader2 className="size-3.5 animate-spin" style={{ color: OG.accent }} />
                  ) : (
                    <span
                      className="grid size-3.5 place-items-center rounded-full text-[8px]"
                      style={{ background: doneStep ? OG.accent : "transparent", color: "#06121f", border: doneStep ? "none" : `1px solid ${OG.border}` }}
                    >
                      {doneStep ? "✓" : ""}
                    </span>
                  )}
                  {label}
                </div>
              );
            })}
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
