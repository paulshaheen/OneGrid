import { T as cn } from "./use-ops-data-B8Zw8Vry.js";
import { Fragment, jsx } from "react/jsx-runtime";
//#region src/components/ops/Skeleton.tsx
/** A single shimmering placeholder bar. Uses the muted token so it themes. */
function Skeleton({ className }) {
	return /* @__PURE__ */ jsx("div", { className: cn("animate-pulse rounded-sm bg-muted", className) });
}
/**
* Placeholder table rows shown during the first data fetch so panes don't pop in
* from empty. Widths vary per column to read like real content, not a grid.
*/
function SkeletonRows({ rows = 8, cols = 6 }) {
	const widths = [
		"w-40",
		"w-20",
		"w-16",
		"w-24",
		"w-12",
		"w-28"
	];
	return /* @__PURE__ */ jsx(Fragment, { children: Array.from({ length: rows }).map((_, r) => /* @__PURE__ */ jsx("tr", {
		className: "border-t",
		children: Array.from({ length: cols }).map((_, c) => /* @__PURE__ */ jsx("td", {
			className: "px-4 py-2.5",
			children: /* @__PURE__ */ jsx(Skeleton, { className: cn("h-3", widths[c % widths.length]) })
		}, c))
	}, r)) });
}
//#endregion
export { SkeletonRows as t };
