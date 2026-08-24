import { n as RISK_LABEL, s as riskColorVar } from "./format-CGsoAMDh.js";
import { T as cn } from "./use-ops-data-B8Zw8Vry.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/ops/RiskBadge.tsx
function RiskBadge({ level, score, className, size = "sm" }) {
	return /* @__PURE__ */ jsxs("span", {
		className: cn("inline-flex items-center gap-1.5 rounded-sm border font-medium uppercase tracking-wider", size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs", className),
		style: {
			color: riskColorVar(level),
			borderColor: `color-mix(in oklch, ${riskColorVar(level)} 45%, transparent)`,
			backgroundColor: `color-mix(in oklch, ${riskColorVar(level)} 12%, transparent)`
		},
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "size-1.5 rounded-full",
				style: { backgroundColor: riskColorVar(level) }
			}),
			RISK_LABEL[level],
			score !== void 0 && /* @__PURE__ */ jsx("span", {
				className: "num opacity-80",
				children: score
			})
		]
	});
}
function StatCell({ label, value, sub, tone }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col gap-1 border-l px-4 py-3 first:border-l-0",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "label-xs",
				children: label
			}),
			/* @__PURE__ */ jsx("span", {
				className: "num text-2xl leading-none font-semibold",
				style: tone ? { color: riskColorVar(tone) } : void 0,
				children: value
			}),
			sub && /* @__PURE__ */ jsx("span", {
				className: "text-[11px] text-muted-foreground",
				children: sub
			})
		]
	});
}
//#endregion
export { StatCell as n, RiskBadge as t };
