import { useState } from "react";
import { Bot, CornerDownLeft, Sparkles, User } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";
import { OpsMap } from "@/components/ops/OpsMap";
import { useOpsBase } from "@/components/ops/ops-nav";
import { useOpsSnapshot } from "@/lib/hooks/use-ops-data";
import { getServices } from "@/lib/services";
import type { CopilotAnswer } from "@/lib/domain/types";

interface Turn {
  role: "user" | "assistant";
  text: string;
  answer?: CopilotAnswer;
}

function renderMarkdownish(text: string) {
  // Render assistant output as plain React nodes — never dangerouslySetInnerHTML.
  // Model/tool output is untrusted; injecting it as HTML is an XSS vector. We only
  // support **bold** spans and leading "- " bullets, everything else stays literal.
  return text.split("\n").map((line, i) => {
    const bulleted = line.replace(/^-\s+/, "• ");
    const parts = bulleted.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return (
      <p key={i} className="min-h-[0.5rem] leading-relaxed">
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j}>{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part}</span>
          ),
        )}
      </p>
    );
  });
}

export function CopilotPage() {
  const base = useOpsBase();
  const { assets, riskMap, event } = useOpsSnapshot(base, 120);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setTurns((t) => [...t, { role: "user", text: question }]);
    setInput("");
    const answer = await getServices(base).copilot.ask(question);
    setTurns((t) => [...t, { role: "assistant", text: answer.text, answer }]);
    setHighlight(answer.highlightAssetIds);
    setBusy(false);
  }

  return (
    <AppShell>
      <PageHeader
        title="Operations Assistant"
        description="Answers are grounded in the current map, asset register, forecast cycle and risk calculations. Relevant assets are highlighted on the map."
      />
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="panel flex h-[calc(100vh-11rem)] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" /> Suggested questions
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {getServices(base)
                    .copilot.suggestions()
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => ask(s)}
                        className="rounded-md border bg-surface p-3 text-left text-xs hover:bg-accent"
                      >
                        {s}
                      </button>
                    ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm border bg-surface">
                  {t.role === "user" ? (
                    <User className="size-3.5" />
                  ) : (
                    <Bot className="size-3.5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  {renderMarkdownish(t.text)}
                  {t.answer && t.answer.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.answer.citations.map((c, j) => (
                        <span
                          key={j}
                          className="rounded-sm border bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.answer && t.answer.highlightAssetIds.length > 0 && (
                    <button
                      onClick={() => setHighlight(t.answer!.highlightAssetIds)}
                      className="mt-2 text-[11px] text-primary hover:underline"
                    >
                      Highlight {t.answer.highlightAssetIds.length} assets on the map
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="text-xs text-muted-foreground">
                Analyzing current forecast and asset exposure…
              </div>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about storm exposure, assets, timing or thresholds…"
              className="flex-1 rounded-sm border bg-card px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Ask <CornerDownLeft className="size-3.5" />
            </button>
          </form>
        </div>

        <div className="panel h-[calc(100vh-11rem)] overflow-hidden">
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
        </div>
      </div>
    </AppShell>
  );
}
