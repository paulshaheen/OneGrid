import { a as coords, i as STATUS_LABEL, s as riskColorVar, t as ASSET_TYPE_LABEL } from "./format-CGsoAMDh.js";
import { u as nearbyAssets } from "./use-ops-data-B8Zw8Vry.js";
import { t as RiskBadge } from "./RiskBadge-C7xjkrUR.js";
import { jsx, jsxs } from "react/jsx-runtime";
import { X } from "lucide-react";
//#region src/components/ops/AssetDetailPanel.tsx
function Row({ label, value }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex items-baseline justify-between gap-3 py-1.5",
		children: [/* @__PURE__ */ jsx("span", {
			className: "text-[11px] text-muted-foreground",
			children: label
		}), /* @__PURE__ */ jsx("span", {
			className: "num text-right text-xs",
			children: value
		})]
	});
}
function Section({ title, children }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "border-t px-4 py-3",
		children: [/* @__PURE__ */ jsx("div", {
			className: "label-xs mb-2",
			children: title
		}), children]
	});
}
function AssetDetailPanel({ asset, risk, event, allAssets, onClose, onSelect }) {
	const nearby = nearbyAssets(asset, allAssets, 75);
	return /* @__PURE__ */ jsxs("div", {
		className: "flex h-full flex-col overflow-y-auto bg-card",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card px-4 py-3",
				children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ jsx("h2", {
						className: "text-sm font-semibold",
						children: asset.name
					}), risk && /* @__PURE__ */ jsx(RiskBadge, {
						level: risk.level,
						score: risk.score
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "mt-1 text-[11px] text-muted-foreground",
					children: [
						ASSET_TYPE_LABEL[asset.type],
						" · ",
						asset.id,
						" · ",
						asset.operator
					]
				})] }), /* @__PURE__ */ jsx("button", {
					onClick: onClose,
					className: "rounded-sm p-1 text-muted-foreground hover:bg-accent",
					"aria-label": "Close",
					children: /* @__PURE__ */ jsx(X, { className: "size-4" })
				})]
			}),
			risk && /* @__PURE__ */ jsxs("div", {
				className: "px-4 py-3",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "flex items-end gap-3",
					children: [/* @__PURE__ */ jsx("div", {
						className: "num text-4xl leading-none font-semibold",
						style: { color: riskColorVar(risk.level) },
						children: risk.score
					}), /* @__PURE__ */ jsxs("div", {
						className: "pb-1 text-[11px] text-muted-foreground",
						children: [
							"risk score / 100",
							/* @__PURE__ */ jsx("br", {}),
							risk.insideCone ? "Inside projected impact corridor" : "Outside projected impact corridor"
						]
					})]
				}), /* @__PURE__ */ jsx("div", {
					className: "mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted",
					children: /* @__PURE__ */ jsx("div", {
						className: "h-full rounded-full",
						style: {
							width: `${risk.score}%`,
							backgroundColor: riskColorVar(risk.level)
						}
					})
				})]
			}),
			/* @__PURE__ */ jsxs(Section, {
				title: "Asset",
				children: [
					/* @__PURE__ */ jsx(Row, {
						label: "Type",
						value: ASSET_TYPE_LABEL[asset.type]
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Location",
						value: coords(asset.lat, asset.lon)
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Region",
						value: asset.region
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Business unit",
						value: asset.businessUnit
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Operating status",
						value: STATUS_LABEL[asset.status]
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Criticality",
						value: asset.criticality.replace("_", " ")
					}),
					Object.entries(asset.metadata).map(([k, v]) => /* @__PURE__ */ jsx(Row, {
						label: k.replace(/_/g, " "),
						value: typeof v === "number" ? v.toLocaleString() : v
					}, k))
				]
			}),
			risk && /* @__PURE__ */ jsxs(Section, {
				title: "Weather & forecast",
				children: [
					/* @__PURE__ */ jsx(Row, {
						label: "Active event",
						value: event?.name ?? "—"
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Storm proximity",
						value: `${risk.distanceMi} mi from centerline`
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Forecast sustained wind",
						value: `${risk.forecastWindMph} mph`
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Forecast rainfall",
						value: `${risk.rainfallIn} in`
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Expected time of impact",
						value: risk.hoursToImpact === null ? "None in horizon" : `${risk.hoursToImpact} hours`
					}),
					/* @__PURE__ */ jsx(Row, {
						label: "Forecast confidence",
						value: event ? event.confidence : "—"
					})
				]
			}),
			risk && /* @__PURE__ */ jsx(Section, {
				title: "Why this score",
				children: /* @__PURE__ */ jsx("ul", {
					className: "space-y-1.5",
					children: risk.factors.map((f) => /* @__PURE__ */ jsxs("li", {
						className: "flex items-start justify-between gap-3 text-xs",
						children: [/* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("span", {
							className: "font-medium",
							children: f.label
						}), /* @__PURE__ */ jsx("span", {
							className: "block text-[11px] text-muted-foreground",
							children: f.detail
						})] }), /* @__PURE__ */ jsxs("span", {
							className: "num shrink-0 text-muted-foreground",
							children: ["+", f.points]
						})]
					}, f.label))
				})
			}),
			risk && risk.recommendations.length > 0 && /* @__PURE__ */ jsx(Section, {
				title: "Recommended operational considerations",
				children: /* @__PURE__ */ jsx("ul", {
					className: "space-y-1.5 text-xs",
					children: risk.recommendations.map((r) => /* @__PURE__ */ jsxs("li", {
						className: "flex gap-2",
						children: [/* @__PURE__ */ jsx("span", { className: "mt-1.5 size-1 shrink-0 rounded-full bg-primary" }), r]
					}, r))
				})
			}),
			/* @__PURE__ */ jsx(Section, {
				title: "Nearby exposed infrastructure",
				children: nearby.length === 0 ? /* @__PURE__ */ jsx("p", {
					className: "text-xs text-muted-foreground",
					children: "No other assets within 75 miles."
				}) : /* @__PURE__ */ jsx("ul", {
					className: "space-y-1",
					children: nearby.map((n) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", {
						onClick: () => onSelect?.(n.id),
						className: "flex w-full items-center justify-between rounded-sm px-1 py-1 text-left text-xs hover:bg-accent",
						children: [/* @__PURE__ */ jsx("span", { children: n.name }), /* @__PURE__ */ jsx("span", {
							className: "text-[11px] text-muted-foreground",
							children: ASSET_TYPE_LABEL[n.type]
						})]
					}) }, n.id))
				})
			})
		]
	});
}
//#endregion
export { AssetDetailPanel as t };
