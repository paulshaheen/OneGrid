import { r as RISK_ORDER, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { C as OpsLink, a as layersQuery, c as useOpsSnapshot, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { t as AssetDetailPanel } from "./AssetDetailPanel-GoUJPX7f.js";
import { useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
//#region src/views/map.tsx
function MapPage() {
	const base = useOpsBase();
	const { assets, riskMap, event } = useOpsSnapshot(base, 120);
	const layerDefs = useQuery(layersQuery(base));
	const [layers, setLayers] = useState({
		assets: true,
		track: true,
		wind: true,
		uncertainty: true,
		previous: false,
		rain: false,
		flood: false,
		satellite: false,
		history: false
	});
	const [selected, setSelected] = useState(null);
	const [q, setQ] = useState("");
	const [type, setType] = useState("all");
	const [level, setLevel] = useState("all");
	const [unit, setUnit] = useState("all");
	const [operator, setOperator] = useState("all");
	useEffect(() => {
		if (!layerDefs.data) return;
		setLayers((current) => {
			const next = { ...current };
			for (const layer of layerDefs.data) if (!(layer.id in next)) next[layer.id] = layer.defaultOn;
			return next;
		});
	}, [layerDefs.data]);
	const units = useMemo(() => Array.from(new Set(assets.map((a) => a.businessUnit))), [assets]);
	const operators = useMemo(() => Array.from(new Set(assets.map((a) => a.operator))), [assets]);
	const filtered = useMemo(() => assets.filter((a) => {
		const risk = riskMap.get(a.id);
		if (q && !`${a.name} ${a.id} ${a.region} ${a.operator}`.toLowerCase().includes(q.toLowerCase())) return false;
		if (type !== "all" && a.type !== type) return false;
		if (unit !== "all" && a.businessUnit !== unit) return false;
		if (operator !== "all" && a.operator !== operator) return false;
		if (level !== "all" && risk?.level !== level) return false;
		return true;
	}), [
		assets,
		q,
		type,
		unit,
		operator,
		level,
		riskMap
	]);
	const selectedAsset = assets.find((a) => a.id === selected) ?? null;
	const ranked = [...filtered].sort((a, b) => (riskMap.get(b.id)?.score ?? 0) - (riskMap.get(a.id)?.score ?? 0));
	return /* @__PURE__ */ jsx(AppShell, { children: /* @__PURE__ */ jsxs("div", {
		className: "flex h-[calc(100vh-3.5rem)] min-h-0",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "hidden w-64 shrink-0 flex-col overflow-y-auto border-r bg-panel md:flex",
				children: [
					event?.cycleShift && /* @__PURE__ */ jsxs("div", {
						className: "border-b p-3",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "label-xs mb-1.5",
								children: "Change since last cycle"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "num text-xs",
								children: [
									/* @__PURE__ */ jsxs("span", {
										className: "text-foreground",
										children: [event.cycleShift.shiftMi, " mi"]
									}),
									" ",
									/* @__PURE__ */ jsx("span", {
										className: "text-muted-foreground",
										children: event.cycleShift.shiftDirection
									})
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "num mt-1 text-[11px] text-muted-foreground",
								children: [
									"Intensity ",
									event.cycleShift.intensityDeltaMph >= 0 ? "+" : "",
									event.cycleShift.intensityDeltaMph,
									" mph · cone",
									" ",
									event.cycleShift.coneDeltaMi >= 0 ? "+" : "",
									event.cycleShift.coneDeltaMi,
									" mi"
								]
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-1.5 text-[11px] leading-relaxed text-muted-foreground",
								children: event.cycleShift.summary
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "num mt-1.5 text-[10px] text-muted-foreground/80",
								children: [
									event.cycleShift.previousCycle,
									" → ",
									event.cycleShift.currentCycle
								]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "border-b p-3",
						children: [/* @__PURE__ */ jsx("div", {
							className: "label-xs mb-2",
							children: "Map layers"
						}), /* @__PURE__ */ jsx("ul", {
							className: "space-y-2",
							children: (layerDefs.data ?? []).map((l) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("label", {
								className: "flex cursor-pointer items-start gap-2 text-xs",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "mt-0.5 accent-[var(--color-primary)]",
									checked: !!layers[l.id],
									onChange: (e) => setLayers((s) => ({
										...s,
										[l.id]: e.target.checked
									}))
								}), /* @__PURE__ */ jsxs("span", { children: [
									/* @__PURE__ */ jsx("span", {
										className: "font-medium",
										children: l.name
									}),
									/* @__PURE__ */ jsx("span", {
										className: "block text-[11px] text-muted-foreground",
										children: l.description
									}),
									/* @__PURE__ */ jsx("span", {
										className: "block text-[10px] text-muted-foreground/80",
										children: l.updatedLabel
									})
								] })]
							}) }, l.id))
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "space-y-2 border-b p-3",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "label-xs",
								children: "Filters"
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "relative",
								children: [/* @__PURE__ */ jsx(Search, { className: "absolute top-2 left-2 size-3.5 text-muted-foreground" }), /* @__PURE__ */ jsx("input", {
									value: q,
									onChange: (e) => setQ(e.target.value),
									placeholder: "Search assets",
									className: "w-full rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
								})]
							}),
							/* @__PURE__ */ jsxs(Select, {
								value: type,
								onChange: (v) => setType(v),
								label: "Asset type",
								children: [/* @__PURE__ */ jsx("option", {
									value: "all",
									children: "All types"
								}), Object.entries(ASSET_TYPE_LABEL).map(([k, v]) => /* @__PURE__ */ jsx("option", {
									value: k,
									children: v
								}, k))]
							}),
							/* @__PURE__ */ jsxs(Select, {
								value: level,
								onChange: (v) => setLevel(v),
								label: "Risk level",
								children: [/* @__PURE__ */ jsx("option", {
									value: "all",
									children: "All risk levels"
								}), RISK_ORDER.map((l) => /* @__PURE__ */ jsx("option", {
									value: l,
									className: "capitalize",
									children: l
								}, l))]
							}),
							/* @__PURE__ */ jsxs(Select, {
								value: unit,
								onChange: setUnit,
								label: "Business unit",
								children: [/* @__PURE__ */ jsx("option", {
									value: "all",
									children: "All business units"
								}), units.map((u) => /* @__PURE__ */ jsx("option", {
									value: u,
									children: u
								}, u))]
							}),
							/* @__PURE__ */ jsxs(Select, {
								value: operator,
								onChange: setOperator,
								label: "Operator",
								children: [/* @__PURE__ */ jsx("option", {
									value: "all",
									children: "All operators"
								}), operators.map((o) => /* @__PURE__ */ jsx("option", {
									value: o,
									children: o
								}, o))]
							})
						]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex-1 overflow-y-auto",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "px-3 py-2 label-xs",
							children: [ranked.length, " assets in view"]
						}), /* @__PURE__ */ jsx("ul", { children: ranked.slice(0, 60).map((a) => {
							const r = riskMap.get(a.id);
							return /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", {
								onClick: () => setSelected(a.id),
								className: `flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-accent ${selected === a.id ? "bg-accent" : ""}`,
								children: [/* @__PURE__ */ jsx("span", {
									className: "truncate",
									children: a.name
								}), r && /* @__PURE__ */ jsx(RiskBadge, {
									level: r.level,
									score: r.score
								})]
							}) }, a.id);
						}) })]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "relative min-w-0 flex-1",
				children: [/* @__PURE__ */ jsx(OpsMap, {
					className: "h-full w-full",
					assets: filtered,
					risks: riskMap,
					event,
					layers,
					catalogLayers: layerDefs.data ?? [],
					selectedId: selected,
					onSelect: setSelected
				}), !event && assets.length === 0 && (layerDefs.data?.length ?? 0) === 0 && /* @__PURE__ */ jsxs("div", {
					className: "pointer-events-none absolute top-3 left-1/2 z-10 w-[min(90%,24rem)] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-2 text-center shadow-sm backdrop-blur",
					children: [/* @__PURE__ */ jsx("p", {
						className: "text-[11px] text-muted-foreground",
						children: "Basemap ready. Assets, catalog layers, and weather will appear automatically."
					}), /* @__PURE__ */ jsx(OpsLink, {
						to: "/",
						className: "pointer-events-auto mt-1 inline-flex text-[11px] font-medium text-primary hover:underline",
						children: "Add data from the Operations Overview"
					})]
				})]
			}),
			selectedAsset && /* @__PURE__ */ jsx("div", {
				className: "w-full max-w-sm shrink-0 border-l",
				children: /* @__PURE__ */ jsx(AssetDetailPanel, {
					asset: selectedAsset,
					risk: riskMap.get(selectedAsset.id),
					event,
					allAssets: assets,
					onClose: () => setSelected(null),
					onSelect: setSelected
				})
			})
		]
	}) });
}
function Select({ value, onChange, label, children }) {
	return /* @__PURE__ */ jsxs("label", {
		className: "block",
		children: [/* @__PURE__ */ jsx("span", {
			className: "sr-only",
			children: label
		}), /* @__PURE__ */ jsx("select", {
			value,
			onChange: (e) => onChange(e.target.value),
			className: "w-full rounded-sm border bg-card px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring",
			children
		})]
	});
}
//#endregion
//#region src/routes/_authenticated/app.map.tsx?tsr-split=component
var SplitComponent = MapPage;
//#endregion
export { SplitComponent as component };
