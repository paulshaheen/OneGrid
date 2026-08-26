import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Plus, Send, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";

// P0: OneGrid Copilot dialog (ported UX from the report-app ChatPanel) on stubbed
// responses. The real backend (Foundry / Fabric Data Agent, KQL + DAX) lands in P2.
const MODELS: Record<string, string[]> = {
  "Azure OpenAI": ["GPT-5", "GPT-4o", "GPT-4o mini"],
  Anthropic: ["Claude Opus 4", "Claude Sonnet 4"],
  Meta: ["Llama 3.1 70B"],
};
const SUGGESTIONS = [
  "Compare Thunder Horse exposure vs last cycle",
  "Which assets trip before landfall?",
  "Open the twin for Compressor B",
];
const INTRO =
  "Ask across the whole grid — weather exposure, asset risk, twin telemetry, or the ontology.";
const STUB =
  "3 platforms exceed the high-risk gate at T-72h: Thunder Horse, Mad Dog, Atlantis. Thunder Horse also has an open twin anomaly on Compressor B.";

type Msg = { who: "ai" | "me"; text: string };

export function CopilotDock({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [model, setModel] = useState("GPT-5");
  const [modelMenu, setModelMenu] = useState(false);
  const [provider, setProvider] = useState<"azure" | "copilot">("azure");
  const [agent, setAgent] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([{ who: "ai", text: INTRO }]);
  const [input, setInput] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [messages, open]);

  const send = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t) return;
    setInput("");
    setMessages((m) => [...m, { who: "me", text: t }]);
    setTimeout(() => setMessages((m) => [...m, { who: "ai", text: STUB }]), 350);
  };
  const reset = () => setMessages([{ who: "ai", text: INTRO }]);

  const lastIsAi = messages[messages.length - 1]?.who === "ai";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white shadow-2xl"
        style={{
          background: "linear-gradient(135deg, var(--color-primary), oklch(0.62 0.13 249))",
        }}
      >
        <Sparkles className="size-4" /> Ask the data
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex max-h-[74vh] w-96 flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
      {/* Header */}
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
                      <div className="px-2 pb-1 pt-1.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
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
              className={cn(
                "size-1.5 rounded-full",
                agent ? "bg-primary" : "bg-muted-foreground/40",
              )}
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

      {/* Messages */}
      <div ref={msgsRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[86%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
              m.who === "ai" ? "self-start bg-surface-raised" : "self-end bg-primary/20",
            )}
          >
            {m.text}
          </div>
        ))}
        {lastIsAi && (
          <div className="flex flex-wrap gap-1.5 self-start">
            {SUGGESTIONS.map((s) => (
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
      </div>

      {/* Input */}
      <div className="flex gap-2 border-t p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about any asset, event, model or the ontology…"
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
        Grounded in Eventhouse (KQL) · semantic model (DAX) · forecast
      </div>
    </div>
  );
}
