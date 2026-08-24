import { n as RISK_LABEL, o as relativeTime, s as riskColorVar, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { C as OpsLink, T as cn, a as layersQuery, b as evaluateRules, c as useOpsSnapshot, d as getDataPlaneStatus, f as seedPublicSample, g as POSTURE_LEVEL_LABEL, n as alertsQuery, o as postureQuery, p as uploadAsset, s as thresholdRulesQuery, w as useOpsBase, x as AppShell } from "./use-ops-data-B8Zw8Vry.js";
import { t as SkeletonRows } from "./Skeleton-LqERzdGS.js";
import { t as OpsMap } from "./OpsMap-Dkngu9Y0.js";
import { n as StatCell, t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { t as AssetDetailPanel } from "./AssetDetailPanel-GoUJPX7f.js";
import { useMemo, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { ArrowRight, CheckCircle2, Database, Filter, Loader2, Sparkles, TrendingUp, Upload, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
//#region src/components/ops/DataOnboarding.tsx
function readAsBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result;
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(/* @__PURE__ */ new Error("Could not read the file."));
		reader.readAsDataURL(file);
	});
}
function DataOnboarding({ className }) {
	const base = useOpsBase();
	const queryClient = useQueryClient();
	const fileInputRef = useRef(null);
	const [note, setNote] = useState(null);
	const status = useQuery({
		queryKey: [base, "data-plane-status"],
		queryFn: () => getDataPlaneStatus(),
		staleTime: 3e5
	});
	const layerCount = useQuery(layersQuery(base)).data?.length ?? 0;
	const upload = useMutation({
		mutationFn: async (file) => {
			const contentBase64 = await readAsBase64(file);
			return uploadAsset({ data: {
				name: file.name,
				contentBase64,
				contentType: file.type
			} });
		},
		onSuccess: (res) => setNote({
			ok: res.ok,
			text: res.message
		}),
		onError: () => setNote({
			ok: false,
			text: "Upload failed unexpectedly."
		})
	});
	const seed = useMutation({
		mutationFn: () => seedPublicSample(),
		onSuccess: (res) => {
			setNote({
				ok: res.ok,
				text: res.message
			});
			if (res.ok) queryClient.invalidateQueries({ queryKey: [base, "layers"] });
		},
		onError: () => setNote({
			ok: false,
			text: "Pre-seeding failed unexpectedly."
		})
	});
	const uploadReady = status.data?.uploadConfigured ?? false;
	const catalogReady = status.data?.geoCatalogConfigured ?? false;
	const busy = upload.isPending || seed.isPending;
	return /* @__PURE__ */ jsx("div", {
		className: cn("flex h-full items-center justify-center overflow-y-auto p-6", className),
		children: /* @__PURE__ */ jsxs("div", {
			className: "w-full max-w-xl rounded-md border bg-surface p-6 shadow-sm",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ jsx(Database, { className: "size-5 text-primary" }), /* @__PURE__ */ jsx("h2", {
						className: "text-base font-semibold tracking-tight",
						children: "Add data to get started"
					})]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1.5 text-xs leading-relaxed text-muted-foreground",
					children: "This deployment is connected but has no data yet. Upload your own geospatial files to the provisioned storage account, or pre-seed the catalog with a public sample. Everything runs through the app's managed identity — no keys or portal steps required."
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-5 grid gap-3 sm:grid-cols-2",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex flex-col rounded-sm border p-4",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ jsx(Upload, { className: "size-4 text-foreground" }), /* @__PURE__ */ jsx("span", {
									className: "text-sm font-medium",
									children: "Upload data"
								})]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "mt-1 flex-1 text-[11px] leading-relaxed text-muted-foreground",
								children: [
									"Send a file to the deployment's",
									" ",
									/* @__PURE__ */ jsx("code", {
										className: "text-[10px]",
										children: "sample-assets"
									}),
									" container. Use it as a source for catalog ingestion."
								]
							}),
							/* @__PURE__ */ jsx("input", {
								ref: fileInputRef,
								type: "file",
								className: "hidden",
								onChange: (e) => {
									const file = e.target.files?.[0];
									if (file) upload.mutate(file);
									e.target.value = "";
								}
							}),
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								disabled: !uploadReady || busy,
								onClick: () => fileInputRef.current?.click(),
								className: "mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
								children: [upload.isPending ? /* @__PURE__ */ jsx(Loader2, { className: "size-3.5 animate-spin" }) : /* @__PURE__ */ jsx(Upload, { className: "size-3.5" }), "Choose file"]
							}),
							!uploadReady && status.isSuccess && /* @__PURE__ */ jsx("span", {
								className: "mt-2 text-[10px] text-muted-foreground",
								children: "Storage not wired for this deployment."
							})
						]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex flex-col rounded-sm border p-4",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ jsx(Sparkles, { className: "size-4 text-foreground" }), /* @__PURE__ */ jsx("span", {
									className: "text-sm font-medium",
									children: "Load public sample"
								})]
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-1 flex-1 text-[11px] leading-relaxed text-muted-foreground",
								children: "Ingest a few public Sentinel-2 scenes over the Gulf of Mexico into a sample collection so the map isn't empty."
							}),
							/* @__PURE__ */ jsxs("button", {
								type: "button",
								disabled: !catalogReady || busy,
								onClick: () => seed.mutate(),
								className: "mt-3 inline-flex items-center justify-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
								children: [seed.isPending ? /* @__PURE__ */ jsx(Loader2, { className: "size-3.5 animate-spin" }) : /* @__PURE__ */ jsx(Sparkles, { className: "size-3.5" }), "Load sample"]
							}),
							!catalogReady && status.isSuccess && /* @__PURE__ */ jsx("span", {
								className: "mt-2 text-[10px] text-muted-foreground",
								children: "GeoCatalog not wired for this deployment."
							})
						]
					})]
				}),
				note && /* @__PURE__ */ jsxs("div", {
					className: cn("mt-4 flex items-start gap-2 rounded-sm border px-3 py-2 text-[11px]", note.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-risk-high/40 bg-risk-high/10 text-risk-high"),
					children: [note.ok ? /* @__PURE__ */ jsx(CheckCircle2, { className: "mt-0.5 size-3.5 shrink-0" }) : null, /* @__PURE__ */ jsx("span", { children: note.text })]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-4 flex items-center justify-between border-t pt-3 text-[10px] text-muted-foreground",
					children: [/* @__PURE__ */ jsxs("span", { children: ["Catalog collections: ", /* @__PURE__ */ jsx("span", {
						className: "num text-foreground",
						children: layerCount
					})] }), /* @__PURE__ */ jsx("span", { children: "Assets are ingested from your GIS or uploaded above." })]
				})
			]
		})
	});
}
//#endregion
//#region src/views/index.tsx
var LEVEL_FILTERS = [
	"critical",
	"high",
	"elevated",
	"monitor"
];
var TYPE_FILTERS = [
	"offshore_platform",
	"pipeline",
	"well",
	"refinery",
	"lng_terminal",
	"port"
];
var POSTURE_TONE = {
	0: "normal",
	1: "monitor",
	2: "elevated",
	3: "high",
	4: "critical"
};
function Chip({ active, onClick, children, color }) {
	return /* @__PURE__ */ jsx("button", {
		onClick,
		className: cn("rounded-sm border px-2 py-1 text-[11px] whitespace-nowrap transition-colors", active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"),
		style: active && color ? {
			borderColor: color,
			color
		} : void 0,
		children
	});
}
function OverviewPage() {
	const base = useOpsBase();
	const { assets, risks, riskMap, event, metrics, isLoading } = useOpsSnapshot(base, 72);
	const alerts = useQuery(alertsQuery(base)).data ?? [];
	const postures = useQuery(postureQuery(base)).data ?? [];
	const rules = useQuery(thresholdRulesQuery(base)).data ?? [];
	const [selected, setSelected] = useState(null);
	const [hovered, setHovered] = useState(null);
	const [levelFilter, setLevelFilter] = useState(/* @__PURE__ */ new Set());
	const [typeFilter, setTypeFilter] = useState(/* @__PURE__ */ new Set());
	const [coneOnly, setConeOnly] = useState(false);
	const toggle = (set, v) => {
		const next = new Set(set);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		return next;
	};
	const filtersActive = levelFilter.size > 0 || typeFilter.size > 0 || coneOnly;
	const clearFilters = () => {
		setLevelFilter(/* @__PURE__ */ new Set());
		setTypeFilter(/* @__PURE__ */ new Set());
		setConeOnly(false);
	};
	/** One filter predicate feeds both the map and every table on the page. */
	const filteredAssets = useMemo(() => assets.filter((a) => {
		const r = riskMap.get(a.id);
		if (typeFilter.size && !typeFilter.has(a.type)) return false;
		if (levelFilter.size && !(r && levelFilter.has(r.level))) return false;
		if (coneOnly && !r?.insideCone) return false;
		return true;
	}), [
		assets,
		riskMap,
		typeFilter,
		levelFilter,
		coneOnly
	]);
	const filteredIds = useMemo(() => new Set(filteredAssets.map((a) => a.id)), [filteredAssets]);
	const ranked = useMemo(() => risks.filter((r) => filteredIds.has(r.assetId)).sort((a, b) => b.score - a.score), [risks, filteredIds]);
	const postureById = useMemo(() => new Map(postures.map((p) => [p.assetId, p])), [postures]);
	const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
	const selectedAsset = selected ? assetById.get(selected) ?? null : null;
	const breaches = useMemo(() => evaluateRules(rules, assets, risks), [
		rules,
		assets,
		risks
	]);
	const breachCritical = breaches.filter((b) => b.severity === "critical").length;
	const postureRollup = [
		4,
		3,
		2
	].map((lvl) => ({
		lvl,
		n: postures.filter((p) => p.level === lvl && filteredIds.has(p.assetId)).length
	}));
	const pob = postures.filter((p) => filteredIds.has(p.assetId)).reduce((acc, p) => ({
		current: acc.current + (p.pobCurrent ?? 0),
		normal: acc.normal + (p.pobNormal ?? 0)
	}), {
		current: 0,
		normal: 0
	});
	const openAlerts = alerts.filter((a) => a.status !== "resolved");
	return /* @__PURE__ */ jsx(AppShell, {
		fullHeight: true,
		children: /* @__PURE__ */ jsxs("div", {
			className: "flex min-h-0 flex-col xl:h-full",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "shrink-0 border-b bg-surface",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap items-center justify-between gap-3 px-5 pt-3",
						children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("h1", {
							className: "text-base font-semibold tracking-tight",
							children: [event?.name ?? "No active event", " — 72 hour outlook"]
						}), event ? /* @__PURE__ */ jsxs("p", {
							className: "num mt-0.5 text-[11px] text-muted-foreground",
							children: [
								event.status,
								" · moving ",
								Math.round(event.movementMph),
								" mph · ",
								event.cycleId,
								" ",
								"updated ",
								relativeTime(event.updatedAtIso)
							]
						}) : /* @__PURE__ */ jsx("p", {
							className: "mt-0.5 text-[11px] text-muted-foreground",
							children: "No active system in the current forecast cycle"
						})] }), /* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-2",
							children: [event?.cycleShift && /* @__PURE__ */ jsxs("span", {
								className: "num inline-flex items-center gap-1.5 rounded-sm border border-risk-high/40 bg-risk-high/10 px-2 py-1 text-[11px] text-risk-high",
								children: [
									/* @__PURE__ */ jsx(TrendingUp, { className: "size-3.5" }),
									event.cycleShift.shiftMi,
									" mi ",
									event.cycleShift.shiftDirection,
									" since",
									" ",
									event.cycleShift.previousCycle
								]
							}), /* @__PURE__ */ jsxs(OpsLink, {
								to: "/copilot",
								className: "inline-flex items-center gap-2 rounded-sm border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15",
								children: [/* @__PURE__ */ jsx(Sparkles, { className: "size-3.5" }), " Operations assistant"]
							})]
						})]
					}), /* @__PURE__ */ jsxs("div", {
						className: "mt-2.5 grid grid-cols-2 border-t sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7",
						children: [
							/* @__PURE__ */ jsx(StatCell, {
								label: "Assets monitored",
								value: metrics.monitored,
								sub: "Across the asset register"
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "Assets exposed",
								value: metrics.exposed,
								sub: "Elevated risk or higher"
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "Inside forecast cone",
								value: metrics.insideCone,
								sub: "Projected impact corridor"
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "High risk",
								value: metrics.high,
								tone: "high",
								sub: "Score 62–79"
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "Critical",
								value: metrics.critical,
								tone: "critical",
								sub: "Score 80+"
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "Threshold breaches",
								value: breaches.length,
								tone: breachCritical > 0 ? "critical" : "high",
								sub: `${breachCritical} at critical severity`
							}),
							/* @__PURE__ */ jsx(StatCell, {
								label: "First expected impact",
								value: metrics.firstImpactHours === null ? "—" : `${metrics.firstImpactHours} h`,
								sub: "Earliest asset onset"
							})
						]
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-panel px-4 py-2",
					children: [
						/* @__PURE__ */ jsx(Filter, { className: "size-3.5 text-muted-foreground" }),
						LEVEL_FILTERS.map((l) => /* @__PURE__ */ jsxs(Chip, {
							active: levelFilter.has(l),
							color: riskColorVar(l),
							onClick: () => setLevelFilter((s) => toggle(s, l)),
							children: [RISK_LABEL[l], /* @__PURE__ */ jsx("span", {
								className: "num ml-1 opacity-70",
								children: risks.filter((r) => r.level === l).length
							})]
						}, l)),
						/* @__PURE__ */ jsx("span", { className: "mx-1 h-4 w-px bg-border" }),
						TYPE_FILTERS.map((t) => /* @__PURE__ */ jsx(Chip, {
							active: typeFilter.has(t),
							onClick: () => setTypeFilter((s) => toggle(s, t)),
							children: ASSET_TYPE_LABEL[t]
						}, t)),
						/* @__PURE__ */ jsx("span", { className: "mx-1 h-4 w-px bg-border" }),
						/* @__PURE__ */ jsx(Chip, {
							active: coneOnly,
							onClick: () => setConeOnly((v) => !v),
							children: "Inside cone only"
						}),
						filtersActive && /* @__PURE__ */ jsxs("button", {
							onClick: clearFilters,
							className: "inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground",
							children: [/* @__PURE__ */ jsx(X, { className: "size-3" }), " Clear"]
						}),
						/* @__PURE__ */ jsxs("span", {
							className: "num ml-auto text-[11px] text-muted-foreground",
							children: [
								filteredAssets.length,
								" of ",
								assets.length,
								" assets in view"
							]
						})
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "grid min-h-0 flex-1 grid-cols-1 gap-px bg-border xl:grid-cols-[minmax(0,1fr)_360px]",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "grid min-h-0 grid-rows-[auto_auto] gap-px bg-border xl:grid-rows-[minmax(0,1.35fr)_minmax(0,1fr)]",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "relative h-[440px] min-h-0 bg-background lg:h-[520px] xl:h-auto",
							children: [/* @__PURE__ */ jsx(OpsMap, {
								className: "h-full w-full",
								assets: filteredAssets,
								risks: riskMap,
								event,
								layers: {
									assets: true,
									track: true,
									wind: true,
									uncertainty: true
								},
								selectedId: selected,
								highlightIds: hovered ? [hovered] : [],
								onSelect: setSelected
							}), assets.length === 0 && /* @__PURE__ */ jsx("div", {
								className: "absolute inset-0 z-10",
								children: /* @__PURE__ */ jsx(DataOnboarding, { className: "h-full bg-background/35 backdrop-blur-[1px]" })
							})]
						}), /* @__PURE__ */ jsxs("div", {
							className: "flex h-[420px] min-h-0 flex-col bg-background xl:h-auto",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex shrink-0 items-center justify-between border-b px-4 py-2",
								children: [/* @__PURE__ */ jsx("span", {
									className: "label-xs",
									children: "Highest exposure — ranked"
								}), /* @__PURE__ */ jsx(OpsLink, {
									to: "/risk",
									className: "text-[11px] text-primary hover:underline",
									children: "Full asset risk register"
								})]
							}), /* @__PURE__ */ jsx("div", {
								className: "min-h-0 flex-1 overflow-y-auto",
								children: /* @__PURE__ */ jsxs("table", {
									className: "w-full text-xs",
									children: [/* @__PURE__ */ jsx("thead", {
										className: "sticky top-0 z-10 bg-surface",
										children: /* @__PURE__ */ jsxs("tr", {
											className: "text-left text-[11px] text-muted-foreground",
											children: [
												/* @__PURE__ */ jsx("th", {
													className: "px-4 py-2 font-medium",
													children: "Asset"
												}),
												/* @__PURE__ */ jsx("th", {
													className: "px-3 py-2 font-medium",
													children: "Type"
												}),
												/* @__PURE__ */ jsx("th", {
													className: "px-3 py-2 font-medium",
													children: "Risk"
												}),
												/* @__PURE__ */ jsx("th", {
													className: "px-3 py-2 font-medium",
													children: "Posture"
												}),
												/* @__PURE__ */ jsx("th", {
													className: "px-3 py-2 font-medium",
													children: "ETA"
												}),
												/* @__PURE__ */ jsx("th", {
													className: "px-4 py-2 font-medium",
													children: "Primary threat"
												})
											]
										})
									}), /* @__PURE__ */ jsxs("tbody", { children: [
										isLoading && ranked.length === 0 && /* @__PURE__ */ jsx(SkeletonRows, {
											rows: 8,
											cols: 6
										}),
										ranked.slice(0, 80).map((r) => {
											const asset = assetById.get(r.assetId);
											if (!asset) return null;
											const p = postureById.get(r.assetId);
											return /* @__PURE__ */ jsxs("tr", {
												className: cn("cursor-pointer border-t hover:bg-accent/50", selected === r.assetId && "bg-accent/70"),
												onClick: () => setSelected(r.assetId),
												onMouseEnter: () => setHovered(r.assetId),
												onMouseLeave: () => setHovered(null),
												children: [
													/* @__PURE__ */ jsx("td", {
														className: "px-4 py-1.5 font-medium",
														children: asset.name
													}),
													/* @__PURE__ */ jsx("td", {
														className: "px-3 py-1.5 text-muted-foreground",
														children: ASSET_TYPE_LABEL[asset.type]
													}),
													/* @__PURE__ */ jsx("td", {
														className: "px-3 py-1.5",
														children: /* @__PURE__ */ jsx(RiskBadge, {
															level: r.level,
															score: r.score
														})
													}),
													/* @__PURE__ */ jsx("td", {
														className: "px-3 py-1.5",
														children: p && p.level > 0 ? /* @__PURE__ */ jsx("span", {
															className: "text-[11px]",
															style: { color: riskColorVar(POSTURE_TONE[p.level]) },
															children: POSTURE_LEVEL_LABEL[p.level]
														}) : /* @__PURE__ */ jsx("span", {
															className: "text-[11px] text-muted-foreground",
															children: "—"
														})
													}),
													/* @__PURE__ */ jsxs("td", {
														className: "num px-3 py-1.5",
														children: [r.hoursToImpact ?? "—", " h"]
													}),
													/* @__PURE__ */ jsx("td", {
														className: "px-4 py-1.5 text-muted-foreground",
														children: r.forecastWindMph >= 74 ? `${r.forecastWindMph} mph sustained wind` : `${r.rainfallIn} in rainfall`
													})
												]
											}, r.assetId);
										}),
										!isLoading && ranked.length === 0 && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", {
											colSpan: 6,
											className: "px-4 py-10 text-center text-muted-foreground",
											children: "No assets match the current filters."
										}) })
									] })]
								})
							})]
						})]
					}), /* @__PURE__ */ jsx("div", {
						className: "min-h-0 bg-background xl:overflow-y-auto",
						children: selectedAsset ? /* @__PURE__ */ jsx(AssetDetailPanel, {
							asset: selectedAsset,
							risk: riskMap.get(selectedAsset.id),
							event,
							allAssets: assets,
							onClose: () => setSelected(null),
							onSelect: setSelected
						}) : /* @__PURE__ */ jsxs("div", {
							className: "divide-y",
							children: [
								/* @__PURE__ */ jsxs("div", {
									className: "p-4",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "label-xs mb-2 flex items-center gap-1.5",
										children: [/* @__PURE__ */ jsx(Sparkles, { className: "size-3.5 text-primary" }), " Operational summary"]
									}), event ? /* @__PURE__ */ jsxs(Fragment, { children: [
										/* @__PURE__ */ jsxs("p", {
											className: "text-xs leading-relaxed",
											children: [
												/* @__PURE__ */ jsx("strong", { children: event.name }),
												" is the active system for the current forecast cycle. ",
												/* @__PURE__ */ jsxs("strong", { children: [metrics.insideCone, " facilities"] }),
												" sit inside the projected corridor and ",
												/* @__PURE__ */ jsxs("strong", { children: [metrics.exposed, " assets"] }),
												" carry elevated risk or higher.",
												" ",
												/* @__PURE__ */ jsxs("strong", { children: [breaches.length, " configured thresholds"] }),
												" are breached this cycle",
												metrics.firstImpactHours !== null ? `, with first onset in ${metrics.firstImpactHours} hours` : "",
												"."
											]
										}),
										event.cycleShift && /* @__PURE__ */ jsx("p", {
											className: "mt-2 text-[11px] leading-relaxed text-muted-foreground",
											children: event.cycleShift.summary
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "mt-2 text-[10px] text-muted-foreground",
											children: [
												"Grounded in the ",
												event.cycleId,
												" forecast cycle, asset register, threshold rules and risk model."
											]
										})
									] }) : /* @__PURE__ */ jsx("p", {
										className: "text-xs leading-relaxed text-muted-foreground",
										children: "No active weather event in the current forecast cycle. When the weather provider reports a system in the operating region, a grounded summary of exposed facilities and breached thresholds appears here."
									})]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "p-4",
									children: [
										/* @__PURE__ */ jsxs("div", {
											className: "mb-2 flex items-center justify-between",
											children: [/* @__PURE__ */ jsx("span", {
												className: "label-xs",
												children: "Response posture"
											}), /* @__PURE__ */ jsx(OpsLink, {
												to: "/posture",
												className: "text-[11px] text-primary hover:underline",
												children: "Open gate board"
											})]
										}),
										/* @__PURE__ */ jsx("div", {
											className: "grid grid-cols-3 gap-2",
											children: postureRollup.map((p) => /* @__PURE__ */ jsxs("div", {
												className: "rounded-sm border px-2 py-2",
												children: [/* @__PURE__ */ jsx("div", {
													className: "text-[10px]",
													style: { color: riskColorVar(POSTURE_TONE[p.lvl]) },
													children: POSTURE_LEVEL_LABEL[p.lvl]
												}), /* @__PURE__ */ jsx("div", {
													className: "num mt-0.5 text-lg leading-none font-semibold",
													children: p.n
												})]
											}, p.lvl))
										}),
										/* @__PURE__ */ jsxs("div", {
											className: "num mt-2 flex items-center justify-between text-[11px] text-muted-foreground",
											children: [/* @__PURE__ */ jsx("span", { children: "Personnel on board" }), /* @__PURE__ */ jsxs("span", {
												className: "text-foreground",
												children: [
													pob.current,
													" / ",
													pob.normal
												]
											})]
										})
									]
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "p-4",
									children: [/* @__PURE__ */ jsxs("div", {
										className: "mb-2 flex items-center justify-between",
										children: [/* @__PURE__ */ jsx("span", {
											className: "label-xs",
											children: "Threshold breaches"
										}), /* @__PURE__ */ jsx(OpsLink, {
											to: "/thresholds",
											className: "text-[11px] text-primary hover:underline",
											children: "Configure"
										})]
									}), /* @__PURE__ */ jsxs("ul", {
										className: "space-y-1.5",
										children: [breaches.slice(0, 5).map((b, i) => /* @__PURE__ */ jsx("li", {
											className: "text-[11px] leading-snug",
											children: /* @__PURE__ */ jsxs("button", {
												className: "text-left hover:underline",
												onClick: () => setSelected(b.assetId),
												onMouseEnter: () => setHovered(b.assetId),
												onMouseLeave: () => setHovered(null),
												children: [/* @__PURE__ */ jsx("span", {
													className: "font-medium",
													children: assetById.get(b.assetId)?.name ?? b.assetId
												}), /* @__PURE__ */ jsxs("span", {
													className: "text-muted-foreground",
													children: [" — ", b.ruleName]
												})]
											})
										}, `${b.ruleId}-${b.assetId}-${i}`)), breaches.length === 0 && /* @__PURE__ */ jsx("li", {
											className: "text-[11px] text-muted-foreground",
											children: "No thresholds breached this cycle."
										})]
									})]
								}),
								/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
									className: "flex items-center justify-between px-4 py-2.5",
									children: [/* @__PURE__ */ jsx("span", {
										className: "label-xs",
										children: "Active alerts"
									}), /* @__PURE__ */ jsx(OpsLink, {
										to: "/alerts",
										className: "text-[11px] text-primary hover:underline",
										children: "All alerts"
									})]
								}), /* @__PURE__ */ jsxs("ul", {
									className: "divide-y border-t",
									children: [openAlerts.slice(0, 6).map((a) => /* @__PURE__ */ jsx("li", {
										className: "px-4 py-2.5",
										children: /* @__PURE__ */ jsxs("div", {
											className: "flex items-start gap-2",
											children: [/* @__PURE__ */ jsx("span", {
												className: "mt-1.5 size-1.5 shrink-0 rounded-full",
												style: { backgroundColor: riskColorVar(a.severity === "critical" ? "critical" : a.severity === "warning" ? "high" : "monitor") }
											}), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
												className: "text-xs leading-snug font-medium",
												children: a.title
											}), /* @__PURE__ */ jsxs("div", {
												className: "mt-0.5 text-[10px] text-muted-foreground",
												children: [
													a.owner,
													" · ",
													relativeTime(a.createdAtIso)
												]
											})] })]
										})
									}, a.id)), openAlerts.length === 0 && /* @__PURE__ */ jsx("li", {
										className: "px-4 py-6 text-center text-[11px] text-muted-foreground",
										children: "No active alerts."
									})]
								})] }),
								/* @__PURE__ */ jsxs(OpsLink, {
									to: "/timeline",
									className: "flex items-center gap-1 px-4 py-3 text-[11px] text-primary hover:underline",
									children: ["Scrub the forecast timeline ", /* @__PURE__ */ jsx(ArrowRight, { className: "size-3" })]
								})
							]
						})
					})]
				})
			]
		})
	});
}
//#endregion
//#region src/routes/_authenticated/app.index.tsx?tsr-split=component
var SplitComponent = OverviewPage;
//#endregion
export { SplitComponent as component };
