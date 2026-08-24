import { a as coords, o as relativeTime } from "./format-CGsoAMDh.js";
import { S as PageHeader, c as useOpsSnapshot, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/views/events.tsx
function EventsPage() {
	const base = useOpsBase();
	const { assets, risks, riskMap, event } = useOpsSnapshot(base, 120);
	const [selected, setSelected] = useState(null);
	if (!event) return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Weather Events",
		description: "Active tropical and severe-weather systems affecting the operating region, with forecast trajectory and asset exposure."
	}), /* @__PURE__ */ jsx("div", {
		className: "p-4",
		children: /* @__PURE__ */ jsxs("div", {
			className: "panel relative h-[min(68vh,620px)] overflow-hidden",
			children: [/* @__PURE__ */ jsx(OpsMap, {
				className: "h-full w-full",
				assets,
				risks: riskMap,
				event,
				layers: {
					assets: true,
					track: true,
					wind: true
				},
				selectedId: selected,
				onSelect: setSelected
			}), /* @__PURE__ */ jsxs("div", {
				className: "pointer-events-none absolute top-3 left-1/2 z-10 w-[min(90%,28rem)] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur",
				children: [/* @__PURE__ */ jsx("h2", {
					className: "text-xs font-semibold",
					children: "No active weather events"
				}), /* @__PURE__ */ jsx("p", {
					className: "mt-0.5 text-[11px] leading-relaxed text-muted-foreground",
					children: "The basemap is ready. New systems and exposed assets will appear automatically when the forecast provider updates."
				})]
			})]
		})
	})] });
	const affected = [...risks].filter((r) => r.score >= 42).sort((a, b) => b.score - a.score);
	const nameOf = (id) => assets.find((a) => a.id === id)?.name ?? id;
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Weather Events",
		description: "Active tropical and severe-weather systems affecting the operating region, with forecast trajectory and asset exposure."
	}), /* @__PURE__ */ jsxs("div", {
		className: "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3",
						children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ jsx("h2", {
								className: "text-sm font-semibold",
								children: event.name
							}), /* @__PURE__ */ jsx("span", {
								className: "rounded-sm border border-risk-critical/40 bg-risk-critical/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-risk-critical uppercase",
								children: event.status
							})]
						}), /* @__PURE__ */ jsxs("p", {
							className: "mt-0.5 text-[11px] text-muted-foreground",
							children: [
								event.basin,
								" · ",
								event.modelSource,
								" · updated ",
								relativeTime(event.updatedAtIso)
							]
						})] }), /* @__PURE__ */ jsxs("div", {
							className: "text-right text-[11px] text-muted-foreground",
							children: ["Forecast confidence", /* @__PURE__ */ jsx("div", {
								className: "text-sm font-medium text-foreground capitalize",
								children: event.confidence
							})]
						})]
					}),
					/* @__PURE__ */ jsx("div", {
						className: "grid grid-cols-2 divide-x divide-y sm:grid-cols-4",
						children: [
							["Current position", coords(event.lat, event.lon)],
							["Sustained wind", `${event.currentWindMph} mph`],
							["Gusts", `${event.gustMph} mph`],
							["Minimum pressure", `${event.pressureMb} mb`],
							["Movement", `${event.movementDeg}° at ${event.movementMph} mph`],
							["Category", `Category ${event.currentCategory}`],
							["Expected landfall", event.expectedLandfall],
							["Assets affected", `${affected.length} at elevated risk+`]
						].map(([label, value]) => /* @__PURE__ */ jsxs("div", {
							className: "px-4 py-3",
							children: [/* @__PURE__ */ jsx("div", {
								className: "label-xs",
								children: label
							}), /* @__PURE__ */ jsx("div", {
								className: "num mt-1 text-xs",
								children: value
							})]
						}, label))
					}),
					/* @__PURE__ */ jsx("div", {
						className: "h-[360px] border-t",
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
							selectedId: selected,
							onSelect: setSelected
						})
					})
				]
			}), /* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [/* @__PURE__ */ jsx("div", {
					className: "border-b px-4 py-2.5 label-xs",
					children: "Forecast timeline"
				}), /* @__PURE__ */ jsxs("table", {
					className: "w-full text-xs",
					children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", {
						className: "text-left text-[11px] text-muted-foreground",
						children: [
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Hour"
							}),
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Position"
							}),
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Category"
							}),
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Sustained wind"
							}),
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Pressure"
							}),
							/* @__PURE__ */ jsx("th", {
								className: "px-4 py-2 font-medium",
								children: "Cone radius"
							})
						]
					}) }), /* @__PURE__ */ jsx("tbody", { children: event.forecast.map((p) => /* @__PURE__ */ jsxs("tr", {
						className: "border-t",
						children: [
							/* @__PURE__ */ jsxs("td", {
								className: "num px-4 py-2",
								children: [
									"+",
									p.hour,
									" h"
								]
							}),
							/* @__PURE__ */ jsx("td", {
								className: "num px-4 py-2 text-muted-foreground",
								children: coords(p.lat, p.lon)
							}),
							/* @__PURE__ */ jsx("td", {
								className: "px-4 py-2",
								children: p.category > 0 ? `Category ${p.category}` : "Tropical storm"
							}),
							/* @__PURE__ */ jsxs("td", {
								className: "num px-4 py-2",
								children: [p.windMph, " mph"]
							}),
							/* @__PURE__ */ jsxs("td", {
								className: "num px-4 py-2",
								children: [p.pressureMb, " mb"]
							}),
							/* @__PURE__ */ jsxs("td", {
								className: "num px-4 py-2",
								children: [p.coneRadiusMi, " mi"]
							})
						]
					}, p.hour)) })]
				})]
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "panel h-fit",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "border-b px-4 py-2.5 label-xs",
				children: [
					"Affected assets (",
					affected.length,
					")"
				]
			}), /* @__PURE__ */ jsx("ul", {
				className: "max-h-[720px] divide-y overflow-y-auto",
				children: affected.map((r) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", {
					onClick: () => setSelected(r.assetId),
					className: "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-accent",
					children: [/* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("span", {
						className: "text-xs font-medium",
						children: nameOf(r.assetId)
					}), /* @__PURE__ */ jsxs("span", {
						className: "block text-[11px] text-muted-foreground",
						children: [
							r.distanceMi,
							" mi · ",
							r.forecastWindMph,
							" mph · impact in ",
							r.hoursToImpact,
							" h"
						]
					})] }), /* @__PURE__ */ jsx(RiskBadge, {
						level: r.level,
						score: r.score
					})]
				}) }, r.assetId))
			})]
		})]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.events.tsx?tsr-split=component
var SplitComponent = EventsPage;
//#endregion
export { SplitComponent as component };
