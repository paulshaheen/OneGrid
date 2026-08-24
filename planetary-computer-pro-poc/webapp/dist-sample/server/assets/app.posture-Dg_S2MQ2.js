import { i as STATUS_LABEL, o as relativeTime, s as riskColorVar, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { S as PageHeader, T as cn, _ as gateStateLabel, c as useOpsSnapshot, g as POSTURE_LEVEL_LABEL, h as POSTURE_GATES, l as getServices, o as postureQuery, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { useMemo, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Check, Circle, Loader2, Minus, RotateCcw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
//#region src/views/posture.tsx
var LEVEL_TONE = {
	0: "normal",
	1: "monitor",
	2: "elevated",
	3: "high",
	4: "critical"
};
var NEXT_STATE = {
	not_started: "in_progress",
	in_progress: "complete",
	complete: "not_started",
	not_required: "not_started"
};
var STATUS_OPTIONS = [
	"producing",
	"reduced",
	"standby",
	"shut_in",
	"evacuating"
];
function GateCell({ state, onCycle, title }) {
	const icon = state === "complete" ? /* @__PURE__ */ jsx(Check, { className: "size-3.5" }) : state === "in_progress" ? /* @__PURE__ */ jsx(Loader2, { className: "size-3.5" }) : state === "not_required" ? /* @__PURE__ */ jsx(Minus, { className: "size-3.5" }) : /* @__PURE__ */ jsx(Circle, { className: "size-3" });
	const tone = state === "complete" ? "border-risk-normal/50 bg-risk-normal/12 text-risk-normal" : state === "in_progress" ? "border-risk-high/50 bg-risk-high/12 text-risk-high" : state === "not_required" ? "border-border/60 text-muted-foreground/50" : "border-border text-muted-foreground";
	return /* @__PURE__ */ jsx("button", {
		onClick: onCycle,
		title: `${title} — ${gateStateLabel(state)} (click to advance)`,
		className: cn("grid size-7 place-items-center rounded-sm border transition-colors hover:brightness-125", tone),
		children: icon
	});
}
function PosturePage() {
	const qc = useQueryClient();
	const base = useOpsBase();
	const { assets, riskMap, event } = useOpsSnapshot(base, 120);
	const postures = useQuery(postureQuery(base)).data ?? [];
	const [onlyActive, setOnlyActive] = useState(true);
	const [actionError, setActionError] = useState(null);
	const rows = useMemo(() => {
		const byId = new Map(assets.map((a) => [a.id, a]));
		return postures.map((p) => ({
			posture: p,
			asset: byId.get(p.assetId),
			risk: riskMap.get(p.assetId)
		})).filter((r) => r.asset).filter((r) => onlyActive ? r.posture.level > 0 : true).sort((a, b) => b.posture.level - a.posture.level || (a.risk?.hoursToImpact ?? 999) - (b.risk?.hoursToImpact ?? 999) || (b.risk?.score ?? 0) - (a.risk?.score ?? 0));
	}, [
		postures,
		assets,
		riskMap,
		onlyActive
	]);
	const levelCounts = [
		4,
		3,
		2,
		1
	].map((lvl) => ({
		lvl,
		n: postures.filter((p) => p.level === lvl).length
	}));
	const pob = postures.reduce((acc, p) => ({
		current: acc.current + (p.pobCurrent ?? 0),
		normal: acc.normal + (p.pobNormal ?? 0)
	}), {
		current: 0,
		normal: 0
	});
	const shutIn = postures.filter((p) => p.productionStatus === "shut_in" || p.productionStatus === "evacuating").length;
	async function cycleGate(assetId, gate, state) {
		setActionError(null);
		try {
			await getServices(base).posture.setGate(assetId, gate, NEXT_STATE[state]);
			await qc.invalidateQueries({ queryKey: [base, "posture"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not record the gate decision.");
		}
	}
	async function setStatus(assetId, status) {
		setActionError(null);
		try {
			await getServices(base).posture.setProductionStatus(assetId, status);
			await qc.invalidateQueries({ queryKey: [base, "posture"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not update production status.");
		}
	}
	async function reset() {
		setActionError(null);
		try {
			await getServices(base).posture.resetOverrides();
			await qc.invalidateQueries({ queryKey: [base, "posture"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not reset overrides.");
		}
	}
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Response posture",
		description: `Lead-time decision gates, production status and personnel on board for ${event?.name ?? "the active event"}. Gates advance automatically with the forecast; click any gate to record the actual decision.`,
		actions: /* @__PURE__ */ jsxs("button", {
			onClick: reset,
			className: "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
			children: [/* @__PURE__ */ jsx(RotateCcw, { className: "size-3.5" }), " Reset to forecast-derived"]
		})
	}), /* @__PURE__ */ jsxs("div", {
		className: "space-y-4 p-4",
		children: [
			actionError && /* @__PURE__ */ jsx("div", {
				role: "alert",
				className: "rounded-sm border border-risk-critical/50 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical",
				children: actionError
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "panel grid grid-cols-2 divide-x md:grid-cols-6",
				children: [
					levelCounts.map((c) => /* @__PURE__ */ jsxs("div", {
						className: "px-4 py-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: "label-xs",
							style: { color: riskColorVar(LEVEL_TONE[c.lvl]) },
							children: POSTURE_LEVEL_LABEL[c.lvl]
						}), /* @__PURE__ */ jsx("div", {
							className: "num mt-1 text-xl font-semibold",
							children: c.n
						})]
					}, c.lvl)),
					/* @__PURE__ */ jsxs("div", {
						className: "px-4 py-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: "label-xs",
							children: "Shut in / evacuating"
						}), /* @__PURE__ */ jsx("div", {
							className: "num mt-1 text-xl font-semibold",
							children: shutIn
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "px-4 py-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: "label-xs",
							children: "Personnel on board"
						}), /* @__PURE__ */ jsxs("div", {
							className: "num mt-1 text-xl font-semibold",
							children: [pob.current, /* @__PURE__ */ jsxs("span", {
								className: "text-sm font-normal text-muted-foreground",
								children: [" / ", pob.normal]
							})]
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap items-center gap-3 border-b px-4 py-2.5",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "label-xs",
								children: "Gate sequence"
							}),
							/* @__PURE__ */ jsx("div", {
								className: "flex flex-wrap gap-3 text-[11px] text-muted-foreground",
								children: POSTURE_GATES.map((g) => /* @__PURE__ */ jsxs("span", {
									className: "num",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "text-foreground",
											children: g.id
										}),
										" ",
										g.label
									]
								}, g.id))
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									checked: onlyActive,
									onChange: (e) => setOnlyActive(e.target.checked),
									className: "accent-primary"
								}), "Only assets in an active posture"]
							})
						]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "overflow-x-auto",
						children: /* @__PURE__ */ jsxs("table", {
							className: "w-full min-w-[900px] text-xs",
							children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", {
								className: "text-left text-[11px] text-muted-foreground",
								children: [
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Facility"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-3 py-2 font-medium",
										children: "Posture"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-3 py-2 font-medium",
										children: "Risk"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-3 py-2 font-medium",
										children: "Onset"
									}),
									POSTURE_GATES.map((g) => /* @__PURE__ */ jsx("th", {
										className: "num px-2 py-2 text-center font-medium",
										children: g.id
									}, g.id)),
									/* @__PURE__ */ jsx("th", {
										className: "px-3 py-2 font-medium",
										children: "Production"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-3 py-2 font-medium",
										children: "POB"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Last decision"
									})
								]
							}) }), /* @__PURE__ */ jsx("tbody", { children: rows.map(({ posture: p, asset, risk }) => /* @__PURE__ */ jsxs("tr", {
								className: "border-t align-middle hover:bg-accent/40",
								children: [
									/* @__PURE__ */ jsxs("td", {
										className: "px-4 py-2",
										children: [/* @__PURE__ */ jsx("div", {
											className: "font-medium",
											children: asset.name
										}), /* @__PURE__ */ jsxs("div", {
											className: "text-[10px] text-muted-foreground",
											children: [
												ASSET_TYPE_LABEL[asset.type],
												" · ",
												asset.region
											]
										})]
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-3 py-2",
										children: /* @__PURE__ */ jsx("span", {
											className: "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
											style: {
												color: riskColorVar(LEVEL_TONE[p.level]),
												borderColor: `color-mix(in oklch, ${riskColorVar(LEVEL_TONE[p.level])} 45%, transparent)`,
												backgroundColor: `color-mix(in oklch, ${riskColorVar(LEVEL_TONE[p.level])} 12%, transparent)`
											},
											children: POSTURE_LEVEL_LABEL[p.level]
										})
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-3 py-2",
										children: risk ? /* @__PURE__ */ jsx(RiskBadge, {
											level: risk.level,
											score: risk.score
										}) : "—"
									}),
									/* @__PURE__ */ jsxs("td", {
										className: "num px-3 py-2 text-muted-foreground",
										children: [risk?.hoursToImpact ?? "—", " h"]
									}),
									POSTURE_GATES.map((g) => /* @__PURE__ */ jsx("td", {
										className: "px-2 py-2 text-center",
										children: /* @__PURE__ */ jsx("div", {
											className: "flex justify-center",
											children: /* @__PURE__ */ jsx(GateCell, {
												state: p.gates[g.id],
												title: `${g.id} ${g.label}`,
												onCycle: () => void cycleGate(p.assetId, g.id, p.gates[g.id])
											})
										})
									}, g.id)),
									/* @__PURE__ */ jsx("td", {
										className: "px-3 py-2",
										children: /* @__PURE__ */ jsx("select", {
											value: p.productionStatus,
											onChange: (e) => void setStatus(p.assetId, e.target.value),
											className: "rounded-sm border bg-card px-1.5 py-1 text-[11px]",
											children: STATUS_OPTIONS.map((s) => /* @__PURE__ */ jsx("option", {
												value: s,
												children: STATUS_LABEL[s]
											}, s))
										})
									}),
									/* @__PURE__ */ jsx("td", {
										className: "num px-3 py-2 text-muted-foreground",
										children: p.pobCurrent === null ? "unmanned" : `${p.pobCurrent} / ${p.pobNormal}`
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 text-[11px] text-muted-foreground",
										children: p.lastDecision ? /* @__PURE__ */ jsxs(Fragment, { children: [
											/* @__PURE__ */ jsx("span", {
												className: "text-foreground",
												children: p.lastDecision.action
											}),
											/* @__PURE__ */ jsx("br", {}),
											p.lastDecision.by,
											" · ",
											relativeTime(p.lastDecision.atIso)
										] }) : /* @__PURE__ */ jsxs(Fragment, { children: ["No decision recorded · owner ", p.decisionOwner] })
									})
								]
							}, p.assetId)) })]
						})
					}),
					rows.length === 0 && /* @__PURE__ */ jsx("div", {
						className: "px-4 py-8 text-center text-xs text-muted-foreground",
						children: "No facility is currently in an active response posture."
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "panel p-4",
				children: [/* @__PURE__ */ jsx("div", {
					className: "label-xs mb-2",
					children: "Gate definitions"
				}), /* @__PURE__ */ jsx("ul", {
					className: "grid gap-2 md:grid-cols-2 xl:grid-cols-3",
					children: POSTURE_GATES.map((g) => /* @__PURE__ */ jsxs("li", {
						className: "rounded-sm border p-3",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "num text-xs font-semibold",
							children: [
								g.id,
								" · ",
								g.label
							]
						}), /* @__PURE__ */ jsx("p", {
							className: "mt-1 text-[11px] leading-relaxed text-muted-foreground",
							children: g.description
						})]
					}, g.id))
				})]
			})
		]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.posture.tsx?tsr-split=component
var SplitComponent = PosturePage;
//#endregion
export { SplitComponent as component };
