import { c as utcStamp, o as relativeTime, s as riskColorVar } from "./format-CGsoAMDh.js";
import { C as OpsLink, S as PageHeader, b as evaluateRules, c as useOpsSnapshot, l as getServices, n as alertsQuery, r as assetsQuery, s as thresholdRulesQuery, t as alertStatusOverridesQuery, v as METRIC_LABEL, w as useOpsBase, x as AppShell, y as METRIC_UNIT } from "./use-ops-data-B8Zw8Vry.js";
import { useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
//#region src/views/alerts.tsx
var SEVERITY_TONE = {
	critical: "critical",
	warning: "high",
	advisory: "monitor",
	info: "normal"
};
function AlertsPage() {
	const qc = useQueryClient();
	const base = useOpsBase();
	const baseAlerts = useQuery(alertsQuery(base)).data ?? [];
	const assets = useQuery(assetsQuery(base)).data ?? [];
	const rules = useQuery(thresholdRulesQuery(base)).data ?? [];
	const statusOverrides = useQuery(alertStatusOverridesQuery(base)).data ?? {};
	const { risks, event } = useOpsSnapshot(base, 120);
	const [actionError, setActionError] = useState(null);
	const derived = useMemo(() => {
		const nameOf = (id) => assets.find((a) => a.id === id)?.name ?? id;
		const cycleIso = event?.updatedAtIso ?? (/* @__PURE__ */ new Date()).toISOString();
		const cycleId = event?.id ?? "current-cycle";
		const perRule = /* @__PURE__ */ new Map();
		return evaluateRules(rules, assets, risks).sort((a, b) => (a.hoursToImpact ?? 999) - (b.hoursToImpact ?? 999)).filter((b) => {
			const n = perRule.get(b.ruleId) ?? 0;
			if (n >= 4) return false;
			perRule.set(b.ruleId, n + 1);
			return true;
		}).map((b) => {
			const id = `${b.ruleId}-${b.assetId}`;
			return {
				id,
				title: `${nameOf(b.assetId)} — ${b.ruleName}`,
				detail: `${METRIC_LABEL[b.metric]} ${b.observed}${METRIC_UNIT[b.metric]} against a configured limit of ${b.comparator === "gte" ? "≥" : "≤"} ${b.threshold}${METRIC_UNIT[b.metric]}${b.hoursToImpact !== null ? `, onset in ${b.hoursToImpact} h` : ""}. ${b.action}`,
				severity: b.severity,
				assetId: b.assetId,
				eventId: cycleId,
				status: statusOverrides[id] ?? "open",
				owner: b.owner,
				createdAtIso: cycleIso
			};
		});
	}, [
		rules,
		assets,
		risks,
		event,
		statusOverrides
	]);
	const alerts = useMemo(() => [...derived, ...baseAlerts].map((a) => ({
		...a,
		status: statusOverrides[a.id] ?? a.status
	})), [
		derived,
		baseAlerts,
		statusOverrides
	]);
	const [severity, setSeverity] = useState("all");
	const [status, setStatus] = useState("all");
	const rows = alerts.filter((a) => severity === "all" ? true : a.severity === severity).filter((a) => status === "all" ? true : a.status === status);
	async function setAlertStatus(id, next) {
		setActionError(null);
		try {
			await getServices(base).alerts.setStatus(id, next);
			await qc.invalidateQueries({ queryKey: [base, "alert-status-overrides"] });
			await qc.invalidateQueries({ queryKey: [base, "alerts"] });
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Could not update the alert status.");
		}
	}
	const counts = [
		"critical",
		"warning",
		"advisory",
		"info"
	].map((s) => ({
		s,
		n: alerts.filter((a) => a.severity === s && a.status !== "resolved").length
	}));
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Alerts",
		description: "Threshold breaches, corridor entries and forecast updates routed to the accountable operations owner.",
		actions: /* @__PURE__ */ jsx(OpsLink, {
			to: "/thresholds",
			className: "rounded-sm border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
			children: "Configure thresholds"
		})
	}), /* @__PURE__ */ jsxs("div", {
		className: "space-y-4 p-4",
		children: [
			actionError && /* @__PURE__ */ jsx("div", {
				role: "alert",
				className: "rounded-sm border border-risk-critical/50 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical",
				children: actionError
			}),
			/* @__PURE__ */ jsx("div", {
				className: "panel grid grid-cols-2 divide-x sm:grid-cols-4",
				children: counts.map((c) => /* @__PURE__ */ jsxs("button", {
					onClick: () => setSeverity(severity === c.s ? "all" : c.s),
					className: `px-4 py-3 text-left hover:bg-accent/50 ${severity === c.s ? "bg-accent/60" : ""}`,
					children: [/* @__PURE__ */ jsx("div", {
						className: "label-xs",
						style: { color: riskColorVar(SEVERITY_TONE[c.s]) },
						children: c.s
					}), /* @__PURE__ */ jsx("div", {
						className: "num mt-1 text-xl font-semibold",
						children: c.n
					})]
				}, c.s))
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2 border-b px-4 py-2.5",
					children: [/* @__PURE__ */ jsxs("select", {
						value: status,
						onChange: (e) => setStatus(e.target.value),
						className: "rounded-sm border bg-card px-2 py-1.5 text-xs",
						children: [
							/* @__PURE__ */ jsx("option", {
								value: "all",
								children: "All statuses"
							}),
							/* @__PURE__ */ jsx("option", {
								value: "open",
								children: "Open"
							}),
							/* @__PURE__ */ jsx("option", {
								value: "acknowledged",
								children: "Acknowledged"
							}),
							/* @__PURE__ */ jsx("option", {
								value: "resolved",
								children: "Resolved"
							})
						]
					}), /* @__PURE__ */ jsxs("span", {
						className: "ml-auto text-[11px] text-muted-foreground",
						children: [rows.length, " alerts"]
					})]
				}), /* @__PURE__ */ jsxs("ul", {
					className: "divide-y",
					children: [rows.map((a) => {
						const asset = assets.find((x) => x.id === a.assetId);
						return /* @__PURE__ */ jsxs("li", {
							className: "flex flex-wrap items-start gap-3 px-4 py-3",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "mt-1.5 size-2 shrink-0 rounded-full",
									style: { backgroundColor: riskColorVar(SEVERITY_TONE[a.severity]) }
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "min-w-[240px] flex-1",
									children: [
										/* @__PURE__ */ jsx("div", {
											className: "text-xs font-medium",
											children: a.title
										}),
										/* @__PURE__ */ jsx("div", {
											className: "mt-0.5 text-[11px] text-muted-foreground",
											children: a.detail
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "num mt-1 text-[10px] text-muted-foreground",
											children: [
												a.id,
												" · ",
												asset ? asset.name : "Estate-wide",
												" · owner ",
												a.owner,
												" ·",
												" ",
												utcStamp(a.createdAtIso),
												" (",
												relativeTime(a.createdAtIso),
												")"
											]
										})
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "flex items-center gap-2",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "rounded-sm border px-2 py-1 text-[10px] tracking-wider uppercase",
											children: a.status
										}),
										a.status === "open" && /* @__PURE__ */ jsx("button", {
											onClick: () => setAlertStatus(a.id, "acknowledged"),
											className: "rounded-sm border px-2 py-1 text-[11px] hover:bg-accent",
											children: "Acknowledge"
										}),
										a.status !== "resolved" && /* @__PURE__ */ jsx("button", {
											onClick: () => setAlertStatus(a.id, "resolved"),
											className: "rounded-sm border px-2 py-1 text-[11px] hover:bg-accent",
											children: "Resolve"
										})
									]
								})
							]
						}, a.id);
					}), rows.length === 0 && /* @__PURE__ */ jsx("li", {
						className: "px-4 py-10 text-center text-xs text-muted-foreground",
						children: "No alerts. Threshold breaches for the current forecast cycle appear here as assets and rules are configured."
					})]
				})]
			})
		]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.alerts.tsx?tsr-split=component
var SplitComponent = AlertsPage;
//#endregion
export { SplitComponent as component };
