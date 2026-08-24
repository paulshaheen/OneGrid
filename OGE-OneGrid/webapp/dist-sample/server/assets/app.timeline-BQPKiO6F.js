import { s as riskColorVar } from "./format-CGsoAMDh.js";
import { C as OpsLink, S as PageHeader, i as eventsQuery, m as scoreAsset, r as assetsQuery, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Pause, Play } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
//#region src/views/timeline.tsx
var STOPS = [
	24,
	48,
	72,
	120
];
function TimelinePage() {
	const base = useOpsBase();
	const assets = useQuery(assetsQuery(base)).data ?? [];
	const event = useQuery(eventsQuery(base)).data?.[0];
	const [hour, setHour] = useState(48);
	const [playing, setPlaying] = useState(false);
	const timer = useRef(null);
	const [selected, setSelected] = useState(null);
	useEffect(() => {
		if (!playing) {
			if (timer.current) clearInterval(timer.current);
			return;
		}
		timer.current = setInterval(() => setHour((h) => h >= 120 ? 0 : h + 3), 220);
		return () => {
			if (timer.current) clearInterval(timer.current);
		};
	}, [playing]);
	const risks = useMemo(() => {
		if (!event) return [];
		return assets.map((a) => scoreAsset(a, event, Math.max(6, hour)));
	}, [
		assets,
		event,
		hour
	]);
	const riskMap = useMemo(() => new Map(risks.map((r) => [r.assetId, r])), [risks]);
	const series = useMemo(() => {
		if (!event) return [];
		return Array.from({ length: 21 }, (_, i) => {
			const h = i * 6;
			const scored = assets.filter((a) => a.type !== "well").map((a) => scoreAsset(a, event, Math.max(6, h)));
			return {
				hour: h,
				exposed: scored.filter((r) => r.score >= 42 && (r.hoursToImpact ?? 999) <= h).length,
				critical: scored.filter((r) => r.level === "critical" && (r.hoursToImpact ?? 999) <= h).length
			};
		});
	}, [assets, event]);
	const maxExposed = Math.max(1, ...series.map((s) => s.exposed));
	const topNow = [...risks].filter((r) => (r.hoursToImpact ?? 999) <= hour).sort((a, b) => b.score - a.score).slice(0, 8);
	const nameOf = (id) => assets.find((a) => a.id === id)?.name ?? id;
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Forecast Timeline",
		description: "Move through the forecast horizon to see storm movement and the corresponding change in asset exposure."
	}), /* @__PURE__ */ jsxs("div", {
		className: "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "panel overflow-hidden",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap items-center gap-3 border-b px-4 py-2.5",
					children: [
						/* @__PURE__ */ jsxs("button", {
							onClick: () => setPlaying((p) => !p),
							className: "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs hover:bg-accent",
							children: [playing ? /* @__PURE__ */ jsx(Pause, { className: "size-3.5" }) : /* @__PURE__ */ jsx(Play, { className: "size-3.5" }), playing ? "Pause" : "Play"]
						}),
						/* @__PURE__ */ jsx("input", {
							type: "range",
							min: 0,
							max: 120,
							step: 3,
							value: hour,
							onChange: (e) => setHour(Number(e.target.value)),
							className: "h-1 min-w-[220px] flex-1 accent-[var(--color-primary)]"
						}),
						/* @__PURE__ */ jsxs("span", {
							className: "num w-20 text-right text-sm font-semibold",
							children: [
								"+",
								hour,
								" h"
							]
						}),
						/* @__PURE__ */ jsx("div", {
							className: "flex gap-1",
							children: STOPS.map((s) => /* @__PURE__ */ jsxs("button", {
								onClick: () => setHour(s),
								className: `rounded-sm border px-2 py-1 text-[11px] ${hour === s ? "bg-accent" : "hover:bg-accent/60"}`,
								children: [s, "h"]
							}, s))
						})
					]
				}), /* @__PURE__ */ jsxs("div", {
					className: "relative h-[420px]",
					children: [/* @__PURE__ */ jsx(OpsMap, {
						className: "h-full w-full",
						assets,
						risks: riskMap,
						event,
						hour,
						layers: {
							assets: true,
							track: true,
							wind: true
						},
						selectedId: selected,
						onSelect: setSelected
					}), !event && /* @__PURE__ */ jsxs("div", {
						className: "pointer-events-none absolute top-3 left-1/2 z-10 w-[min(90%,24rem)] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur",
						children: [/* @__PURE__ */ jsx("p", {
							className: "text-[11px] text-muted-foreground",
							children: "Basemap ready. Forecast movement will appear when weather data is available."
						}), assets.length === 0 && /* @__PURE__ */ jsx(OpsLink, {
							to: "/",
							className: "pointer-events-auto mt-1 inline-flex text-[11px] font-medium text-primary hover:underline",
							children: "Add operational data"
						})]
					})]
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "panel p-4",
				children: [/* @__PURE__ */ jsx("div", {
					className: "label-xs mb-3",
					children: "Exposure over the forecast horizon"
				}), /* @__PURE__ */ jsx("div", {
					className: "flex h-40 items-end gap-1",
					children: series.map((s) => /* @__PURE__ */ jsxs("button", {
						onClick: () => setHour(s.hour),
						className: "group flex flex-1 flex-col items-center justify-end gap-1",
						title: `+${s.hour} h — ${s.exposed} exposed`,
						children: [/* @__PURE__ */ jsx("div", {
							className: "w-full rounded-t-sm transition-opacity",
							style: {
								height: `${s.exposed / maxExposed * 100}%`,
								backgroundColor: riskColorVar(s.critical > 0 ? "critical" : "elevated"),
								opacity: s.hour <= hour ? 1 : .28
							}
						}), /* @__PURE__ */ jsx("span", {
							className: "num text-[9px] text-muted-foreground",
							children: s.hour % 24 === 0 ? s.hour : ""
						})]
					}, s.hour))
				})]
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "panel h-fit",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "border-b px-4 py-2.5 label-xs",
				children: [
					"Exposed at +",
					hour,
					" h"
				]
			}), /* @__PURE__ */ jsxs("ul", {
				className: "divide-y",
				children: [topNow.length === 0 && /* @__PURE__ */ jsx("li", {
					className: "px-4 py-4 text-xs text-muted-foreground",
					children: "No assets reach impact onset before this hour."
				}), topNow.map((r) => /* @__PURE__ */ jsxs("li", {
					className: "flex items-center justify-between gap-2 px-4 py-2.5",
					children: [/* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("span", {
						className: "text-xs font-medium",
						children: nameOf(r.assetId)
					}), /* @__PURE__ */ jsxs("span", {
						className: "block text-[11px] text-muted-foreground",
						children: [
							r.distanceMi,
							" mi · ",
							r.forecastWindMph,
							" mph · onset ",
							r.hoursToImpact,
							" h"
						]
					})] }), /* @__PURE__ */ jsx(RiskBadge, {
						level: r.level,
						score: r.score
					})]
				}, r.assetId))]
			})]
		})]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.timeline.tsx?tsr-split=component
var SplitComponent = TimelinePage;
//#endregion
export { SplitComponent as component };
