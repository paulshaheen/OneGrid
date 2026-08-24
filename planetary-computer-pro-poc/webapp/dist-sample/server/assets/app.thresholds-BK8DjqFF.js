import { s as riskColorVar, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { S as PageHeader, b as evaluateRules, c as useOpsSnapshot, l as getServices, s as thresholdRulesQuery, v as METRIC_LABEL, w as useOpsBase, x as AppShell, y as METRIC_UNIT } from "./use-ops-data-B8Zw8Vry.js";
import { useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
//#region src/views/thresholds.tsx
var SEVERITY_TONE = {
	critical: "critical",
	warning: "high",
	advisory: "monitor",
	info: "normal"
};
var ALL_TYPES = [
	"offshore_platform",
	"pipeline",
	"well",
	"refinery",
	"lng_terminal",
	"storage",
	"port"
];
var METRICS = [
	"wind",
	"rain",
	"eta",
	"score",
	"distance"
];
function blankRule() {
	return {
		id: `THR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
		name: "New operational threshold",
		assetTypes: ["offshore_platform"],
		metric: "wind",
		comparator: "gte",
		value: 60,
		appliesAboveScore: 30,
		severity: "warning",
		action: "Describe the operational action this threshold triggers.",
		owner: "Operations Duty Manager",
		enabled: true,
		builtIn: false
	};
}
function ThresholdsPage() {
	const qc = useQueryClient();
	const base = useOpsBase();
	const { assets, risks } = useOpsSnapshot(base, 120);
	const rules = useQuery(thresholdRulesQuery(base)).data ?? [];
	const [editing, setEditing] = useState(null);
	const [actionError, setActionError] = useState(null);
	const breaches = useMemo(() => evaluateRules(rules, assets, risks), [
		rules,
		assets,
		risks
	]);
	const nameOf = (id) => assets.find((a) => a.id === id)?.name ?? id;
	const breachCount = useMemo(() => {
		const m = /* @__PURE__ */ new Map();
		for (const b of breaches) m.set(b.ruleId, (m.get(b.ruleId) ?? 0) + 1);
		return m;
	}, [breaches]);
	async function save(rule) {
		setActionError(null);
		try {
			await getServices(base).thresholds.saveRule(rule);
			await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
			setEditing(null);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not save the threshold.");
		}
	}
	async function remove(id) {
		setActionError(null);
		try {
			await getServices(base).thresholds.deleteRule(id);
			await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not delete the threshold.");
		}
	}
	async function reset() {
		setActionError(null);
		try {
			await getServices(base).thresholds.resetRules();
			await qc.invalidateQueries({ queryKey: [base, "threshold-rules"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not restore defaults.");
		}
	}
	return /* @__PURE__ */ jsxs(AppShell, { children: [
		/* @__PURE__ */ jsx(PageHeader, {
			title: "Operational thresholds",
			description: "Starter defaults based on common energy-sector limits (crane cut-offs, helideck limits, shut-in triggers, flood watches) — review and replace with your own operating procedures. Edits are saved to this deployment. Rules are evaluated against every asset in the current forecast cycle; breaches drive the alert feed.",
			actions: /* @__PURE__ */ jsxs("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ jsxs("button", {
					onClick: () => setEditing(blankRule()),
					className: "inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15",
					children: [/* @__PURE__ */ jsx(Plus, { className: "size-3.5" }), " New threshold"]
				}), /* @__PURE__ */ jsxs("button", {
					onClick: reset,
					className: "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
					children: [/* @__PURE__ */ jsx(RotateCcw, { className: "size-3.5" }), " Restore defaults"]
				})]
			})
		}),
		actionError && /* @__PURE__ */ jsx("div", {
			className: "px-4 pt-4",
			children: /* @__PURE__ */ jsx("div", {
				role: "alert",
				className: "rounded-sm border border-risk-critical/50 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical",
				children: actionError
			})
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center justify-between border-b px-4 py-2.5",
					children: [/* @__PURE__ */ jsx("span", {
						className: "label-xs",
						children: "Threshold rules"
					}), /* @__PURE__ */ jsxs("span", {
						className: "text-[11px] text-muted-foreground",
						children: [
							rules.filter((r) => r.enabled).length,
							" active · ",
							breaches.length,
							" breaches this cycle"
						]
					})]
				}), /* @__PURE__ */ jsx("ul", {
					className: "divide-y",
					children: rules.map((rule) => /* @__PURE__ */ jsx("li", {
						className: "px-4 py-3",
						children: /* @__PURE__ */ jsxs("div", {
							className: "flex flex-wrap items-start gap-3",
							children: [
								/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									checked: rule.enabled,
									onChange: () => void save({
										...rule,
										enabled: !rule.enabled
									}),
									className: "mt-1 accent-primary",
									"aria-label": `Enable ${rule.name}`
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "min-w-[220px] flex-1",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "flex items-center gap-2",
											children: [
												/* @__PURE__ */ jsx("span", {
													className: "text-xs font-medium",
													children: rule.name
												}),
												/* @__PURE__ */ jsx("span", {
													className: "rounded-sm border px-1.5 py-0.5 text-[9.5px] font-medium tracking-wide uppercase",
													style: {
														color: riskColorVar(SEVERITY_TONE[rule.severity]),
														borderColor: `color-mix(in oklch, ${riskColorVar(SEVERITY_TONE[rule.severity])} 45%, transparent)`
													},
													children: rule.severity
												}),
												!rule.builtIn && /* @__PURE__ */ jsx("span", {
													className: "rounded-sm border px-1.5 py-0.5 text-[9.5px] text-muted-foreground",
													children: "custom"
												})
											]
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "num mt-1 text-[11px] text-muted-foreground",
											children: [
												METRIC_LABEL[rule.metric],
												" ",
												rule.comparator === "gte" ? "≥" : "≤",
												" ",
												rule.value,
												" ",
												METRIC_UNIT[rule.metric],
												" · exposure ≥ ",
												rule.appliesAboveScore,
												" ",
												"· ",
												rule.assetTypes.map((t) => ASSET_TYPE_LABEL[t]).join(", ")
											]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "mt-1 text-[11px] text-muted-foreground",
											children: rule.action
										})
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-2",
									children: [
										/* @__PURE__ */ jsxs("span", {
											className: "num rounded-sm border px-2 py-1 text-[11px]",
											style: { color: (breachCount.get(rule.id) ?? 0) > 0 ? riskColorVar(SEVERITY_TONE[rule.severity]) : void 0 },
											children: [breachCount.get(rule.id) ?? 0, " breaching"]
										}),
										/* @__PURE__ */ jsx("button", {
											onClick: () => setEditing(rule),
											className: "rounded-sm border px-2 py-1 text-[11px] hover:bg-accent",
											children: "Edit"
										}),
										!rule.builtIn && /* @__PURE__ */ jsx("button", {
											onClick: () => void remove(rule.id),
											className: "rounded-sm border p-1.5 text-muted-foreground hover:bg-accent hover:text-risk-critical",
											"aria-label": "Delete threshold",
											children: /* @__PURE__ */ jsx(Trash2, { className: "size-3.5" })
										})
									]
								})
							]
						})
					}, rule.id))
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "space-y-4",
				children: [editing && /* @__PURE__ */ jsxs("div", {
					className: "panel p-4",
					children: [/* @__PURE__ */ jsx("div", {
						className: "label-xs mb-3",
						children: editing.builtIn ? "Edit threshold" : "Threshold definition"
					}), /* @__PURE__ */ jsxs("div", {
						className: "space-y-3 text-xs",
						children: [
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "label-xs",
									children: "Name"
								}), /* @__PURE__ */ jsx("input", {
									value: editing.name,
									onChange: (e) => setEditing({
										...editing,
										name: e.target.value
									}),
									className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid grid-cols-3 gap-2",
								children: [
									/* @__PURE__ */ jsxs("label", {
										className: "block",
										children: [/* @__PURE__ */ jsx("span", {
											className: "label-xs",
											children: "Metric"
										}), /* @__PURE__ */ jsx("select", {
											value: editing.metric,
											onChange: (e) => setEditing({
												...editing,
												metric: e.target.value
											}),
											className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs",
											children: METRICS.map((m) => /* @__PURE__ */ jsx("option", {
												value: m,
												children: METRIC_LABEL[m]
											}, m))
										})]
									}),
									/* @__PURE__ */ jsxs("label", {
										className: "block",
										children: [/* @__PURE__ */ jsx("span", {
											className: "label-xs",
											children: "Comparator"
										}), /* @__PURE__ */ jsxs("select", {
											value: editing.comparator,
											onChange: (e) => setEditing({
												...editing,
												comparator: e.target.value
											}),
											className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs",
											children: [/* @__PURE__ */ jsx("option", {
												value: "gte",
												children: "at or above"
											}), /* @__PURE__ */ jsx("option", {
												value: "lte",
												children: "at or below"
											})]
										})]
									}),
									/* @__PURE__ */ jsxs("label", {
										className: "block",
										children: [/* @__PURE__ */ jsxs("span", {
											className: "label-xs",
											children: [
												"Value (",
												METRIC_UNIT[editing.metric],
												")"
											]
										}), /* @__PURE__ */ jsx("input", {
											type: "number",
											value: editing.value,
											onChange: (e) => setEditing({
												...editing,
												value: Number(e.target.value)
											}),
											className: "num mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
										})]
									})
								]
							}),
							/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", {
								className: "label-xs",
								children: "Applies to asset classes"
							}), /* @__PURE__ */ jsx("div", {
								className: "mt-1 flex flex-wrap gap-1.5",
								children: ALL_TYPES.map((t) => {
									const on = editing.assetTypes.includes(t);
									return /* @__PURE__ */ jsx("button", {
										onClick: () => setEditing({
											...editing,
											assetTypes: on ? editing.assetTypes.filter((x) => x !== t) : [...editing.assetTypes, t]
										}),
										className: `rounded-sm border px-2 py-1 text-[11px] ${on ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground"}`,
										children: ASSET_TYPE_LABEL[t]
									}, t);
								})
							})] }),
							/* @__PURE__ */ jsxs("div", {
								className: "grid grid-cols-2 gap-2",
								children: [/* @__PURE__ */ jsxs("label", {
									className: "block",
									children: [/* @__PURE__ */ jsx("span", {
										className: "label-xs",
										children: "Only above exposure score"
									}), /* @__PURE__ */ jsx("input", {
										type: "number",
										value: editing.appliesAboveScore,
										onChange: (e) => setEditing({
											...editing,
											appliesAboveScore: Number(e.target.value)
										}),
										className: "num mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
									})]
								}), /* @__PURE__ */ jsxs("label", {
									className: "block",
									children: [/* @__PURE__ */ jsx("span", {
										className: "label-xs",
										children: "Severity"
									}), /* @__PURE__ */ jsxs("select", {
										value: editing.severity,
										onChange: (e) => setEditing({
											...editing,
											severity: e.target.value
										}),
										className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs",
										children: [
											/* @__PURE__ */ jsx("option", {
												value: "critical",
												children: "Critical"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "warning",
												children: "Warning"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "advisory",
												children: "Advisory"
											}),
											/* @__PURE__ */ jsx("option", {
												value: "info",
												children: "Info"
											})
										]
									})]
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "label-xs",
									children: "Owner"
								}), /* @__PURE__ */ jsx("input", {
									value: editing.owner,
									onChange: (e) => setEditing({
										...editing,
										owner: e.target.value
									}),
									className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "label-xs",
									children: "Operational action"
								}), /* @__PURE__ */ jsx("textarea", {
									value: editing.action,
									onChange: (e) => setEditing({
										...editing,
										action: e.target.value
									}),
									rows: 3,
									className: "mt-1 w-full rounded-sm border bg-card px-2 py-1.5 text-xs"
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ jsx("button", {
									onClick: () => void save(editing),
									className: "rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15",
									children: "Save threshold"
								}), /* @__PURE__ */ jsx("button", {
									onClick: () => setEditing(null),
									className: "rounded-sm border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent",
									children: "Cancel"
								})]
							})
						]
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "panel",
					children: [/* @__PURE__ */ jsx("div", {
						className: "border-b px-4 py-2.5 label-xs",
						children: "Breaches in the current cycle"
					}), /* @__PURE__ */ jsxs("ul", {
						className: "max-h-[560px] divide-y overflow-y-auto",
						children: [breaches.slice(0, 60).map((b, i) => /* @__PURE__ */ jsx("li", {
							className: "px-4 py-2.5",
							children: /* @__PURE__ */ jsxs("div", {
								className: "flex items-start gap-2",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mt-1.5 size-1.5 shrink-0 rounded-full",
									style: { backgroundColor: riskColorVar(SEVERITY_TONE[b.severity]) }
								}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
									className: "text-xs font-medium",
									children: nameOf(b.assetId)
								}), /* @__PURE__ */ jsxs("div", {
									className: "num mt-0.5 text-[11px] text-muted-foreground",
									children: [
										b.ruleName,
										" · ",
										METRIC_LABEL[b.metric],
										" ",
										b.observed,
										METRIC_UNIT[b.metric],
										" vs ",
										b.comparator === "gte" ? "≥" : "≤",
										" ",
										b.threshold,
										METRIC_UNIT[b.metric],
										b.hoursToImpact !== null && ` · onset ${b.hoursToImpact}h`
									]
								})] })]
							})
						}, `${b.ruleId}-${b.assetId}-${i}`)), breaches.length === 0 && /* @__PURE__ */ jsx("li", {
							className: "px-4 py-8 text-center text-xs text-muted-foreground",
							children: "No thresholds are breached in this forecast cycle."
						})]
					})]
				})]
			})]
		})
	] });
}
//#endregion
//#region src/routes/_authenticated/app.thresholds.tsx?tsr-split=component
var SplitComponent = ThresholdsPage;
//#endregion
export { SplitComponent as component };
