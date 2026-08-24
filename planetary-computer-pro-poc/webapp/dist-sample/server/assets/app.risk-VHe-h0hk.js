import { r as RISK_ORDER, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { S as PageHeader, c as useOpsSnapshot, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as SkeletonRows } from "./Skeleton-LqERzdGS.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { t as AssetDetailPanel } from "./AssetDetailPanel-GoUJPX7f.js";
import { useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowUpDown, Search } from "lucide-react";
//#region src/views/risk.tsx
function RiskPage() {
	const base = useOpsBase();
	const { assets, risks, riskMap, event, isLoading } = useOpsSnapshot(base, 120);
	const [q, setQ] = useState("");
	const [level, setLevel] = useState("all");
	const [sort, setSort] = useState("score");
	const [selected, setSelected] = useState(null);
	const rows = useMemo(() => {
		const list = risks.map((r) => ({
			risk: r,
			asset: assets.find((a) => a.id === r.assetId)
		})).filter((x) => x.asset).filter((x) => level === "all" ? true : x.risk.level === level).filter((x) => q ? `${x.asset.name} ${x.asset.id} ${x.asset.region} ${x.asset.operator}`.toLowerCase().includes(q.toLowerCase()) : true);
		list.sort((a, b) => {
			if (sort === "score") return b.risk.score - a.risk.score;
			if (sort === "wind") return b.risk.forecastWindMph - a.risk.forecastWindMph;
			if (sort === "eta") return (a.risk.hoursToImpact ?? 9999) - (b.risk.hoursToImpact ?? 9999);
			return a.asset.name.localeCompare(b.asset.name);
		});
		return list;
	}, [
		risks,
		assets,
		level,
		q,
		sort
	]);
	const selectedAsset = assets.find((a) => a.id === selected) ?? null;
	const counts = RISK_ORDER.map((l) => ({
		level: l,
		n: risks.filter((r) => r.level === l).length
	}));
	return /* @__PURE__ */ jsxs(AppShell, { children: [/* @__PURE__ */ jsx(PageHeader, {
		title: "Asset Risk",
		description: "Every score is explainable: proximity to the predicted centerline, forecast wind and rainfall, time to impact, storm intensity, asset criticality and asset type."
	}), /* @__PURE__ */ jsxs("div", {
		className: "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [/* @__PURE__ */ jsx("div", {
				className: "panel grid grid-cols-2 divide-x sm:grid-cols-5",
				children: counts.map((c) => /* @__PURE__ */ jsxs("button", {
					onClick: () => setLevel(level === c.level ? "all" : c.level),
					className: `px-4 py-3 text-left transition-colors hover:bg-accent/50 ${level === c.level ? "bg-accent/60" : ""}`,
					children: [/* @__PURE__ */ jsx(RiskBadge, { level: c.level }), /* @__PURE__ */ jsx("div", {
						className: "num mt-1.5 text-xl font-semibold",
						children: c.n
					})]
				}, c.level))
			}), /* @__PURE__ */ jsxs("div", {
				className: "panel",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap items-center gap-2 border-b px-4 py-2.5",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "relative",
							children: [/* @__PURE__ */ jsx(Search, { className: "absolute top-2 left-2 size-3.5 text-muted-foreground" }), /* @__PURE__ */ jsx("input", {
								value: q,
								onChange: (e) => setQ(e.target.value),
								placeholder: "Search assets, regions, operators",
								className: "w-64 rounded-sm border bg-card py-1.5 pr-2 pl-7 text-xs outline-none focus:ring-1 focus:ring-ring"
							})]
						}),
						/* @__PURE__ */ jsxs("select", {
							value: sort,
							onChange: (e) => setSort(e.target.value),
							className: "rounded-sm border bg-card px-2 py-1.5 text-xs",
							children: [
								/* @__PURE__ */ jsx("option", {
									value: "score",
									children: "Sort: risk score"
								}),
								/* @__PURE__ */ jsx("option", {
									value: "eta",
									children: "Sort: impact ETA"
								}),
								/* @__PURE__ */ jsx("option", {
									value: "wind",
									children: "Sort: forecast wind"
								}),
								/* @__PURE__ */ jsx("option", {
									value: "name",
									children: "Sort: asset name"
								})
							]
						}),
						/* @__PURE__ */ jsxs("span", {
							className: "ml-auto text-[11px] text-muted-foreground",
							children: [rows.length, " assets"]
						})
					]
				}), /* @__PURE__ */ jsx("div", {
					className: "max-h-[640px] overflow-y-auto",
					children: /* @__PURE__ */ jsxs("table", {
						className: "w-full text-xs",
						children: [/* @__PURE__ */ jsx("thead", {
							className: "sticky top-0 bg-card",
							children: /* @__PURE__ */ jsxs("tr", {
								className: "text-left text-[11px] text-muted-foreground",
								children: [
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Asset"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Type"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Region"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: /* @__PURE__ */ jsxs("span", {
											className: "inline-flex items-center gap-1",
											children: ["Risk ", /* @__PURE__ */ jsx(ArrowUpDown, { className: "size-3" })]
										})
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Impact ETA"
									}),
									/* @__PURE__ */ jsx("th", {
										className: "px-4 py-2 font-medium",
										children: "Primary threat"
									})
								]
							})
						}), /* @__PURE__ */ jsxs("tbody", { children: [
							isLoading && rows.length === 0 && /* @__PURE__ */ jsx(SkeletonRows, {
								rows: 10,
								cols: 6
							}),
							rows.map(({ risk, asset }) => /* @__PURE__ */ jsxs("tr", {
								onClick: () => setSelected(asset.id),
								className: `cursor-pointer border-t hover:bg-accent/50 ${selected === asset.id ? "bg-accent/60" : ""}`,
								children: [
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 font-medium",
										children: asset.name
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 text-muted-foreground",
										children: ASSET_TYPE_LABEL[asset.type]
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 text-muted-foreground",
										children: asset.region
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2",
										children: /* @__PURE__ */ jsx(RiskBadge, {
											level: risk.level,
											score: risk.score
										})
									}),
									/* @__PURE__ */ jsxs("td", {
										className: "num px-4 py-2",
										children: [risk.hoursToImpact ?? "—", " h"]
									}),
									/* @__PURE__ */ jsx("td", {
										className: "px-4 py-2 text-muted-foreground",
										children: risk.forecastWindMph >= 74 ? `${risk.forecastWindMph} mph sustained wind` : risk.rainfallIn >= 4 ? `${risk.rainfallIn} in rainfall` : "Monitoring only"
									})
								]
							}, asset.id)),
							!isLoading && rows.length === 0 && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", {
								colSpan: 6,
								className: "px-4 py-10 text-center text-muted-foreground",
								children: assets.length === 0 ? "No assets yet — add data from the Operations Overview to populate the risk register." : "No assets match the current search or filter."
							}) })
						] })]
					})
				})]
			})]
		}), /* @__PURE__ */ jsxs("div", {
			className: "space-y-4",
			children: [/* @__PURE__ */ jsx("div", {
				className: "panel h-[340px] overflow-hidden",
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
			}), selectedAsset ? /* @__PURE__ */ jsx("div", {
				className: "panel max-h-[520px] overflow-hidden",
				children: /* @__PURE__ */ jsx(AssetDetailPanel, {
					asset: selectedAsset,
					risk: riskMap.get(selectedAsset.id),
					event,
					allAssets: assets,
					onClose: () => setSelected(null),
					onSelect: setSelected
				})
			}) : /* @__PURE__ */ jsx("div", {
				className: "panel p-4 text-xs text-muted-foreground",
				children: "Select an asset to synchronize the table, map and risk explanation."
			})]
		})]
	})] });
}
//#endregion
//#region src/routes/_authenticated/app.risk.tsx?tsr-split=component
var SplitComponent = RiskPage;
//#endregion
export { SplitComponent as component };
