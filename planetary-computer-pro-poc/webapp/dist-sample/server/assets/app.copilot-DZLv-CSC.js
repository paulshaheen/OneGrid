import { S as PageHeader, c as useOpsSnapshot, l as getServices, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Bot, CornerDownLeft, Sparkles, User } from "lucide-react";
//#region src/views/copilot.tsx
function renderMarkdownish(text) {
	return text.split("\n").map((line, i) => {
		const parts = line.replace(/^-\s+/, "• ").split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
		return /* @__PURE__ */ jsx("p", {
			className: "min-h-[0.5rem] leading-relaxed",
			children: parts.map((part, j) => part.startsWith("**") && part.endsWith("**") ? /* @__PURE__ */ jsx("strong", { children: part.slice(2, -2) }, j) : /* @__PURE__ */ jsx("span", { children: part }, j))
		}, i);
	});
}
function CopilotPage() {
	const base = useOpsBase();
	const { assets, riskMap, event } = useOpsSnapshot(base, 120);
	const [turns, setTurns] = useState([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [highlight, setHighlight] = useState([]);
	const [selected, setSelected] = useState(null);
	async function ask(question) {
		if (!question.trim() || busy) return;
		setBusy(true);
		setTurns((t) => [...t, {
			role: "user",
			text: question
		}]);
		setInput("");
		const answer = await getServices(base).copilot.ask(question);
		setTurns((t) => [...t, {
			role: "assistant",
			text: answer.text,
			answer
		}]);
		setHighlight(answer.highlightAssetIds);
		setBusy(false);
	}
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Operations Assistant",
		description: "Answers are grounded in the current map, asset register, forecast cycle and risk calculations. Relevant assets are highlighted on the map."
	}), /* @__PURE__ */ jsxs("div", {
		className: "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_460px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "panel flex h-[calc(100vh-11rem)] flex-col",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "flex-1 space-y-4 overflow-y-auto p-4",
				children: [
					turns.length === 0 && /* @__PURE__ */ jsxs("div", {
						className: "space-y-3",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-2 text-xs text-muted-foreground",
							children: [/* @__PURE__ */ jsx(Sparkles, { className: "size-3.5 text-primary" }), " Suggested questions"]
						}), /* @__PURE__ */ jsx("div", {
							className: "grid gap-2 sm:grid-cols-2",
							children: getServices(base).copilot.suggestions().map((s) => /* @__PURE__ */ jsx("button", {
								onClick: () => ask(s),
								className: "rounded-md border bg-surface p-3 text-left text-xs hover:bg-accent",
								children: s
							}, s))
						})]
					}),
					turns.map((t, i) => /* @__PURE__ */ jsxs("div", {
						className: "flex gap-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: "mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm border bg-surface",
							children: t.role === "user" ? /* @__PURE__ */ jsx(User, { className: "size-3.5" }) : /* @__PURE__ */ jsx(Bot, { className: "size-3.5 text-primary" })
						}), /* @__PURE__ */ jsxs("div", {
							className: "min-w-0 flex-1 text-xs",
							children: [
								renderMarkdownish(t.text),
								t.answer && t.answer.citations.length > 0 && /* @__PURE__ */ jsx("div", {
									className: "mt-2 flex flex-wrap gap-1.5",
									children: t.answer.citations.map((c, j) => /* @__PURE__ */ jsx("span", {
										className: "rounded-sm border bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground",
										children: c.label
									}, j))
								}),
								t.answer && t.answer.highlightAssetIds.length > 0 && /* @__PURE__ */ jsxs("button", {
									onClick: () => setHighlight(t.answer.highlightAssetIds),
									className: "mt-2 text-[11px] text-primary hover:underline",
									children: [
										"Highlight ",
										t.answer.highlightAssetIds.length,
										" assets on the map"
									]
								})
							]
						})]
					}, i)),
					busy && /* @__PURE__ */ jsx("div", {
						className: "text-xs text-muted-foreground",
						children: "Analyzing current forecast and asset exposure…"
					})
				]
			}), /* @__PURE__ */ jsxs("form", {
				className: "flex items-center gap-2 border-t p-3",
				onSubmit: (e) => {
					e.preventDefault();
					ask(input);
				},
				children: [/* @__PURE__ */ jsx("input", {
					value: input,
					onChange: (e) => setInput(e.target.value),
					placeholder: "Ask about storm exposure, assets, timing or thresholds…",
					className: "flex-1 rounded-sm border bg-card px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-ring"
				}), /* @__PURE__ */ jsxs("button", {
					type: "submit",
					disabled: busy,
					className: "inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50",
					children: ["Ask ", /* @__PURE__ */ jsx(CornerDownLeft, { className: "size-3.5" })]
				})]
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "panel h-[calc(100vh-11rem)] overflow-hidden",
			children: /* @__PURE__ */ jsx(OpsMap, {
				className: "h-full w-full",
				assets,
				risks: riskMap,
				event,
				layers: {
					assets: true,
					track: true,
					wind: true
				},
				highlightIds: highlight,
				selectedId: selected,
				onSelect: setSelected
			})
		})]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.copilot.tsx?tsr-split=component
var SplitComponent = CopilotPage;
//#endregion
export { SplitComponent as component };
