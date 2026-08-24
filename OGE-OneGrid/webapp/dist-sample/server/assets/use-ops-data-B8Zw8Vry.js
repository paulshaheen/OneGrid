import { i as getServerFnById, n as createServerFn, r as TSS_SERVER_FUNCTION } from "./server-Cu4Ib7au.js";
import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { AlertTriangle, Bot, Database, Gauge, LayoutGrid, Map as Map$1, Moon, ServerCog, ShieldAlert, SlidersHorizontal, Sun, Timer, Wind } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { queryOptions, useQuery } from "@tanstack/react-query";
//#region src/lib/utils.ts
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
//#endregion
//#region src/components/ops/ops-nav.tsx
/** The console is served under /app/* (tenant data). Kept as a helper so views
* and links resolve their paths from a single place. */
function useOpsBase() {
	return "/app";
}
function OpsLink({ to, ...rest }) {
	const base = useOpsBase();
	const href = to === "/" ? base : `${base}${to}`;
	return /* @__PURE__ */ jsx(Link, {
		to: href,
		...rest
	});
}
//#endregion
//#region src/components/ops/AppShell.tsx
var NAV = [
	{
		to: "/",
		label: "Operations Overview",
		icon: LayoutGrid
	},
	{
		to: "/map",
		label: "Live Map",
		icon: Map$1
	},
	{
		to: "/events",
		label: "Weather Events",
		icon: Wind
	},
	{
		to: "/risk",
		label: "Asset Risk",
		icon: Gauge
	},
	{
		to: "/timeline",
		label: "Forecast Timeline",
		icon: Timer
	},
	{
		to: "/posture",
		label: "Response Posture",
		icon: ShieldAlert
	},
	{
		to: "/thresholds",
		label: "Thresholds",
		icon: SlidersHorizontal
	},
	{
		to: "/alerts",
		label: "Alerts",
		icon: AlertTriangle
	},
	{
		to: "/copilot",
		label: "Operations Assistant",
		icon: Bot
	},
	{
		to: "/assets",
		label: "Asset Management",
		icon: Database
	},
	{
		to: "/deployment",
		label: "Deployment",
		icon: ServerCog
	}
];
function useTheme() {
	const [dark, setDark] = useState(true);
	useEffect(() => {
		const stored = localStorage.getItem("ops-theme");
		const isDark = stored ? stored === "dark" : true;
		setDark(isDark);
		document.documentElement.classList.toggle("dark", isDark);
	}, []);
	const toggle = () => {
		setDark((d) => {
			const next = !d;
			document.documentElement.classList.toggle("dark", next);
			localStorage.setItem("ops-theme", next ? "dark" : "light");
			return next;
		});
	};
	return {
		dark,
		toggle
	};
}
function AppShell({ children, fullHeight = false }) {
	const { dark, toggle } = useTheme();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const base = useOpsBase();
	const href = (to) => to === "/" ? base : `${base}${to}`;
	return /* @__PURE__ */ jsxs("div", {
		className: cn("flex bg-background text-foreground", fullHeight ? "min-h-screen xl:h-screen xl:overflow-hidden" : "min-h-screen"),
		children: [/* @__PURE__ */ jsxs("aside", {
			className: "sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "flex h-14 items-center gap-2.5 border-b px-4",
					children: [/* @__PURE__ */ jsx("div", {
						className: "grid size-7 place-items-center rounded-sm bg-primary text-primary-foreground",
						children: /* @__PURE__ */ jsx(Wind, { className: "size-4" })
					}), /* @__PURE__ */ jsxs("div", {
						className: "leading-tight",
						children: [/* @__PURE__ */ jsx("div", {
							className: "text-[13px] font-semibold tracking-tight",
							children: "Asset Weather Ops"
						}), /* @__PURE__ */ jsx("div", {
							className: "text-[10px] text-muted-foreground",
							children: "Energy operations"
						})]
					})]
				}),
				/* @__PURE__ */ jsx("nav", {
					className: "flex-1 space-y-0.5 overflow-y-auto p-2",
					children: NAV.map((item) => {
						const target = href(item.to);
						const active = item.to === "/" ? path === target || path === `${target}/` : path.startsWith(target);
						return /* @__PURE__ */ jsxs(OpsLink, {
							to: item.to,
							className: cn("flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"),
							children: [/* @__PURE__ */ jsx(item.icon, { className: "size-4 shrink-0" }), item.label]
						}, item.to);
					})
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "border-t p-3 text-[11px] text-muted-foreground",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("span", { className: "size-1.5 rounded-full bg-risk-monitor" }), "Tenant deployment"]
					}), /* @__PURE__ */ jsx("div", {
						className: "mt-1",
						children: "Data reflects the current forecast cycle"
					})]
				})
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "flex min-w-0 flex-1 flex-col",
			children: [/* @__PURE__ */ jsxs("header", {
				className: "sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-surface/95 px-4 backdrop-blur",
				children: [/* @__PURE__ */ jsx("div", {
					className: "lg:hidden",
					children: /* @__PURE__ */ jsx("select", {
						className: "rounded-sm border bg-card px-2 py-1.5 text-xs",
						value: path,
						onChange: (e) => window.location.href = e.target.value,
						children: NAV.map((n) => /* @__PURE__ */ jsx("option", {
							value: href(n.to),
							children: n.label
						}, n.to))
					})
				}), /* @__PURE__ */ jsx("div", {
					className: "ml-auto flex items-center gap-3",
					children: /* @__PURE__ */ jsx("button", {
						onClick: toggle,
						className: "rounded-sm border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
						"aria-label": "Toggle theme",
						children: dark ? /* @__PURE__ */ jsx(Sun, { className: "size-4" }) : /* @__PURE__ */ jsx(Moon, { className: "size-4" })
					})
				})]
			}), /* @__PURE__ */ jsx("main", {
				className: cn("min-w-0 flex-1", fullHeight && "xl:min-h-0 xl:overflow-hidden"),
				children
			})]
		})]
	});
}
function PageHeader({ title, description, actions }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-wrap items-end justify-between gap-3 border-b bg-surface px-5 py-4",
		children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h1", {
			className: "text-lg font-semibold tracking-tight",
			children: title
		}), /* @__PURE__ */ jsx("p", {
			className: "mt-0.5 max-w-3xl text-xs text-muted-foreground",
			children: description
		})] }), actions]
	});
}
//#endregion
//#region src/lib/services/thresholds.ts
var METRIC_LABEL = {
	wind: "Forecast sustained wind",
	rain: "Forecast rainfall",
	eta: "Hours to impact",
	score: "Risk score",
	distance: "Distance to centerline"
};
var METRIC_UNIT = {
	wind: "mph",
	rain: "in",
	eta: "h",
	score: "pts",
	distance: "mi"
};
var DEFAULT_RULES = [
	{
		id: "THR-CRANE",
		name: "Crane & lifting operations suspension",
		assetTypes: ["offshore_platform", "port"],
		metric: "wind",
		comparator: "gte",
		value: 40,
		appliesAboveScore: 25,
		severity: "advisory",
		action: "Suspend crane, lifting and over-side work; secure deck cargo.",
		owner: "Offshore Marine Assurance",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-HELI",
		name: "Helicopter transfer cut-off",
		assetTypes: ["offshore_platform", "port"],
		metric: "wind",
		comparator: "gte",
		value: 46,
		appliesAboveScore: 25,
		severity: "warning",
		action: "Close helideck to routine transfers; complete crew changes ahead of onset.",
		owner: "Aviation Duty Officer",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-DOWNMAN",
		name: "Down-man decision window",
		assetTypes: ["offshore_platform"],
		metric: "eta",
		comparator: "lte",
		value: 72,
		appliesAboveScore: 45,
		severity: "warning",
		action: "Convene down-manning decision; confirm aviation and marine capacity.",
		owner: "GoM Operations Duty Manager",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-SHUTIN",
		name: "Production shut-in trigger",
		assetTypes: ["offshore_platform", "well"],
		metric: "wind",
		comparator: "gte",
		value: 74,
		appliesAboveScore: 45,
		severity: "critical",
		action: "Execute shut-in sequence and confirm subsea isolation.",
		owner: "Production Operations Superintendent",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-ROW",
		name: "Pipeline right-of-way flooding",
		assetTypes: ["pipeline"],
		metric: "rain",
		comparator: "gte",
		value: 5,
		appliesAboveScore: 20,
		severity: "warning",
		action: "Inspect scour-prone crossings; review right-of-way access routes.",
		owner: "Midstream Integrity",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-SAFESHUT",
		name: "Refinery safe-shutdown lead time",
		assetTypes: ["refinery", "storage"],
		metric: "eta",
		comparator: "lte",
		value: 48,
		appliesAboveScore: 40,
		severity: "warning",
		action: "Start safe-shutdown sequence; verify drainage, berms and flare capacity.",
		owner: "Refinery Shift Superintendent",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-LNG",
		name: "LNG marine loading cut-off",
		assetTypes: ["lng_terminal"],
		metric: "wind",
		comparator: "gte",
		value: 39,
		appliesAboveScore: 25,
		severity: "warning",
		action: "Disconnect loading arms and clear vessels from the berth.",
		owner: "LNG Terminal Duty Manager",
		enabled: true,
		builtIn: true
	},
	{
		id: "THR-SURGE",
		name: "Coastal flooding watch",
		assetTypes: [
			"port",
			"refinery",
			"lng_terminal",
			"storage"
		],
		metric: "rain",
		comparator: "gte",
		value: 8,
		appliesAboveScore: 30,
		severity: "critical",
		action: "Activate flood-preparedness plan and stage dewatering equipment.",
		owner: "Emergency Response Coordinator",
		enabled: true,
		builtIn: true
	}
];
function observed(metric, risk) {
	switch (metric) {
		case "wind": return risk.forecastWindMph;
		case "rain": return risk.rainfallIn;
		case "eta": return risk.hoursToImpact;
		case "score": return risk.score;
		case "distance": return risk.distanceMi;
	}
}
function evaluateRules(rules, assets, risks) {
	const assetById = new Map(assets.map((a) => [a.id, a]));
	const out = [];
	for (const rule of rules) {
		if (!rule.enabled) continue;
		for (const risk of risks) {
			const asset = assetById.get(risk.assetId);
			if (!asset || !rule.assetTypes.includes(asset.type)) continue;
			if (risk.score < rule.appliesAboveScore) continue;
			const value = observed(rule.metric, risk);
			if (value === null) continue;
			if (!(rule.comparator === "gte" ? value >= rule.value : value <= rule.value)) continue;
			out.push({
				ruleId: rule.id,
				ruleName: rule.name,
				assetId: risk.assetId,
				metric: rule.metric,
				observed: value,
				threshold: rule.value,
				comparator: rule.comparator,
				severity: rule.severity,
				action: rule.action,
				owner: rule.owner,
				hoursToImpact: risk.hoursToImpact
			});
		}
	}
	const rank = {
		critical: 0,
		warning: 1,
		advisory: 2,
		info: 3
	};
	return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.hoursToImpact ?? 999) - (b.hoursToImpact ?? 999));
}
//#endregion
//#region src/lib/services/posture.ts
var POSTURE_GATES = [
	{
		id: "T-120",
		leadHours: 120,
		label: "Watch declared",
		description: "Incident management team stood up; forecast cycle reviewed twice daily."
	},
	{
		id: "T-96",
		leadHours: 96,
		label: "Secure & logistics plan",
		description: "Loose equipment secured, marine and aviation capacity reserved, supply runs re-sequenced."
	},
	{
		id: "T-72",
		leadHours: 72,
		label: "Non-essential down-man",
		description: "Non-essential personnel flown to shore; drilling and construction activity suspended."
	},
	{
		id: "T-48",
		leadHours: 48,
		label: "Shut-in sequence",
		description: "Production ramped down, wells shut in, subsea isolation confirmed."
	},
	{
		id: "T-24",
		leadHours: 24,
		label: "Full evacuation complete",
		description: "Facility unmanned, helideck closed, remote monitoring confirmed."
	}
];
var POSTURE_LEVEL_LABEL = {
	0: "Normal operations",
	1: "Watch",
	2: "Prepare",
	3: "Down-man",
	4: "Evacuate & shut in"
};
var GATE_STATE_LABEL = {
	not_started: "Not started",
	in_progress: "In progress",
	complete: "Complete",
	not_required: "Not required"
};
function gateStateLabel(state) {
	return GATE_STATE_LABEL[state];
}
/** Facilities that carry people and therefore run the full gate sequence. */
var MANNED = /* @__PURE__ */ new Set([
	"offshore_platform",
	"port",
	"refinery",
	"lng_terminal"
]);
var NORMAL_POB = {
	offshore_platform: 128,
	refinery: 410,
	lng_terminal: 240,
	port: 180
};
var OWNER = {
	offshore_platform: "GoM Offshore Installation Manager",
	pipeline: "Midstream Integrity Duty Lead",
	well: "Subsea Operations Supervisor",
	refinery: "Refinery Shift Superintendent",
	lng_terminal: "LNG Terminal Duty Manager",
	storage: "Terminals Operations Lead",
	port: "Logistics Control"
};
/** Gate state purely from lead time: a gate is worked in the 12 h before its T-mark. */
function gateFromEta(eta, leadHours) {
	if (eta === null) return "not_started";
	if (eta > leadHours) return "not_started";
	if (eta > leadHours - 12) return "in_progress";
	return "complete";
}
function levelFor(risk) {
	if (!risk) return 0;
	const eta = risk.hoursToImpact ?? 999;
	if (risk.level === "critical" && eta <= 48) return 4;
	if (risk.score >= 70 || risk.level === "critical" && eta <= 96) return 3;
	if (risk.score >= 50) return 2;
	if (risk.score >= 30 || risk.insideCone) return 1;
	return 0;
}
function statusFor(asset, level, eta) {
	if (level >= 4) return asset.type === "offshore_platform" ? "evacuating" : "shut_in";
	if (level === 3) return "shut_in";
	if (level === 2) return "reduced";
	if (level === 1) return eta !== null && eta <= 96 ? "producing" : "standby";
	return asset.status;
}
function derivePosture(asset, risk) {
	const eta = risk?.hoursToImpact ?? null;
	const level = levelFor(risk);
	const exposed = (risk?.score ?? 0) >= 30;
	const manned = MANNED.has(asset.type);
	const gates = {};
	for (const g of POSTURE_GATES) {
		if (!exposed) {
			gates[g.id] = "not_required";
			continue;
		}
		if (!manned && (g.id === "T-72" || g.id === "T-24")) {
			gates[g.id] = "not_required";
			continue;
		}
		gates[g.id] = gateFromEta(eta, g.leadHours);
	}
	const next = POSTURE_GATES.find((g) => gates[g.id] === "not_started" || gates[g.id] === "in_progress");
	const normalPob = manned ? NORMAL_POB[asset.type] ?? 90 : null;
	const pob = normalPob === null ? null : Math.round(normalPob * (level >= 4 ? 0 : level === 3 ? .32 : level === 2 ? .68 : 1));
	const decision = level >= 3 ? {
		action: level >= 4 ? "Full evacuation authorised" : "Non-essential down-manning authorised",
		by: OWNER[asset.type] ?? "Operations Duty Manager",
		atIso: (/* @__PURE__ */ new Date(Date.now() - (level >= 4 ? 42 : 96) * 60 * 1e3)).toISOString()
	} : level === 2 ? {
		action: "Pre-storm secure checklist issued",
		by: OWNER[asset.type] ?? "Operations Duty Manager",
		atIso: (/* @__PURE__ */ new Date(Date.now() - 108e5)).toISOString()
	} : null;
	return {
		assetId: asset.id,
		level,
		gates,
		productionStatus: statusFor(asset, level, eta),
		pobCurrent: pob,
		pobNormal: normalPob,
		decisionOwner: OWNER[asset.type] ?? "Operations Duty Manager",
		nextGate: next?.id ?? null,
		nextGateDueHours: next && eta !== null ? Math.max(0, Math.round(eta - next.leadHours)) : null,
		lastDecision: decision
	};
}
//#endregion
//#region src/lib/services/risk-engine.ts
var EARTH_MI = 3958.8;
var toRad = (d) => d * Math.PI / 180;
function haversineMi(aLat, aLon, bLat, bLon) {
	const dLat = toRad(bLat - aLat);
	const dLon = toRad(bLon - aLon);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_MI * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
/** Distance from an asset to the forecast centerline, interpolated between forecast points. */
function trackProximity(asset, event, maxHour = 120) {
	let best = null;
	const points = event.forecast.filter((p) => p.hour <= maxHour);
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		const next = points[i + 1];
		const samples = [{
			lat: p.lat,
			lon: p.lon,
			hour: p.hour,
			base: p
		}];
		if (next) for (let t = 1; t < 6; t++) {
			const f = t / 6;
			samples.push({
				lat: p.lat + (next.lat - p.lat) * f,
				lon: p.lon + (next.lon - p.lon) * f,
				hour: p.hour + (next.hour - p.hour) * f,
				base: f < .5 ? p : next
			});
		}
		for (const s of samples) {
			const d = haversineMi(asset.lat, asset.lon, s.lat, s.lon);
			if (!best || d < best.distanceMi) {
				const cone = s.base.coneRadiusMi;
				best = {
					distanceMi: d,
					hoursToImpact: s.hour,
					nearest: {
						...s.base,
						hour: Math.round(s.hour)
					},
					insideCone: d <= Math.max(cone, 25)
				};
			}
		}
	}
	return best ?? {
		distanceMi: Number.POSITIVE_INFINITY,
		hoursToImpact: null,
		nearest: event.forecast[0],
		insideCone: false
	};
}
/** Forecast sustained wind at the asset, decaying radially from the storm core. */
function forecastWindAt(distanceMi, coreWindMph) {
	const eyewall = 30;
	if (distanceMi <= eyewall) return coreWindMph;
	const decay = Math.exp(-(distanceMi - eyewall) / 95);
	return Math.max(12, Math.round(coreWindMph * decay));
}
function forecastRainfallAt(distanceMi, category) {
	const base = 3 + category * 1.9;
	return Math.max(.2, Number((base * Math.exp(-distanceMi / 180)).toFixed(1)));
}
function levelFromScore(score) {
	if (score >= 80) return "critical";
	if (score >= 62) return "high";
	if (score >= 42) return "elevated";
	if (score >= 22) return "monitor";
	return "normal";
}
var TYPE_SENSITIVITY = {
	offshore_platform: {
		points: 8,
		note: "Offshore facility — crew evacuation and shut-in lead time required"
	},
	pipeline: {
		points: 5,
		note: "Subsea/onshore pipeline — scour, rainfall and right-of-way exposure"
	},
	lng_terminal: {
		points: 6,
		note: "LNG terminal — marine loading and storm surge sensitivity"
	},
	refinery: {
		points: 6,
		note: "Refinery — flooding and safe-shutdown lead time"
	},
	storage: {
		points: 4,
		note: "Storage facility — surge and access exposure"
	},
	port: {
		points: 5,
		note: "Port/logistics base — staging capacity is critical during evacuations"
	},
	well: {
		points: 2,
		note: "Wellhead — limited manned exposure"
	}
};
var CRITICALITY = {
	business_critical: {
		points: 10,
		label: "Asset designated business-critical"
	},
	important: {
		points: 6,
		label: "Asset designated operationally important"
	},
	standard: {
		points: 2,
		label: "Asset designated standard criticality"
	}
};
function scoreAsset(asset, event, horizonHours = 120) {
	const prox = trackProximity(asset, event, horizonHours);
	const wind = forecastWindAt(prox.distanceMi, prox.nearest.windMph);
	const rain = forecastRainfallAt(prox.distanceMi, prox.nearest.category);
	const factors = [];
	const distPoints = Math.round(Math.max(0, 26 * Math.exp(-prox.distanceMi / 70)));
	factors.push({
		label: "Storm proximity",
		detail: `${Math.round(prox.distanceMi)} miles from the predicted storm centerline`,
		points: distPoints
	});
	const windPoints = Math.round(Math.min(24, Math.max(0, (wind - 50) / 3.7)));
	factors.push({
		label: "Forecast wind",
		detail: `${wind} mph sustained forecast at closest approach`,
		points: windPoints
	});
	const rainPoints = Math.round(Math.min(8, rain * .9));
	factors.push({
		label: "Forecast rainfall",
		detail: `${rain} in forecast accumulation`,
		points: rainPoints
	});
	const eta = prox.hoursToImpact;
	const etaPoints = eta === null ? 0 : Math.round(Math.max(0, 10 - eta / 12));
	factors.push({
		label: "Time to impact",
		detail: eta === null ? "No impact within the forecast horizon" : `Closest approach in ${Math.round(eta)} hours`,
		points: etaPoints
	});
	const intensityPoints = prox.distanceMi > 220 ? 0 : Math.round(prox.nearest.category * 2);
	factors.push({
		label: "Storm intensity",
		detail: `${event.name} forecast at ${prox.nearest.category > 0 ? `Category ${prox.nearest.category}` : "tropical storm strength"} at closest approach`,
		points: intensityPoints
	});
	const crit = CRITICALITY[asset.criticality];
	factors.push({
		label: "Asset criticality",
		detail: crit.label,
		points: crit.points
	});
	const sens = TYPE_SENSITIVITY[asset.type];
	factors.push({
		label: "Asset type sensitivity",
		detail: sens.note,
		points: sens.points
	});
	if (prox.insideCone) factors.push({
		label: "Forecast cone",
		detail: "Asset lies inside the projected impact corridor",
		points: 6
	});
	const raw = factors.reduce((sum, f) => sum + f.points, 0);
	const score = Math.max(0, Math.min(100, Math.round(raw)));
	return {
		assetId: asset.id,
		score,
		level: levelFromScore(score),
		eventId: event.id,
		distanceMi: Math.round(prox.distanceMi),
		forecastWindMph: wind,
		rainfallIn: rain,
		hoursToImpact: eta === null ? null : Math.round(eta),
		insideCone: prox.insideCone,
		factors: factors.filter((f) => f.points > 0),
		recommendations: recommend(asset, wind, eta, prox.insideCone, rain)
	};
}
function recommend(asset, wind, eta, insideCone, rain) {
	const out = [];
	const etaText = eta === null ? "the forecast horizon" : `${Math.round(eta)} hours`;
	if (asset.type === "offshore_platform") {
		if (wind >= 90) out.push(`Initiate non-essential personnel down-manning; full evacuation decision within ${etaText}.`);
		else if (wind >= 60) out.push("Begin pre-storm secure checklist and suspend crane and helideck operations.");
		else out.push("Maintain normal operations; confirm weather-window reporting cadence.");
		if (wind >= 74) out.push("Prepare production shut-in sequence and confirm subsea isolation readiness.");
	}
	if (asset.type === "pipeline") {
		out.push(rain >= 5 ? "Review right-of-way access and scour-prone crossings ahead of rainfall." : "Confirm pigging and inspection schedule against forecast window.");
		if (wind >= 74) out.push("Coordinate throughput reduction with upstream shut-in plan.");
	}
	if (asset.type === "refinery" || asset.type === "storage") out.push(rain >= 6 ? "Activate flood-preparedness plan and verify drainage and berm readiness." : "Verify safe-shutdown lead time against forecast onset.");
	if (asset.type === "lng_terminal") out.push("Review marine loading schedule and confirm vessel departure cut-off times.");
	if (asset.type === "port") out.push("Confirm evacuation staging capacity and vessel berth allocation priority.");
	if (asset.type === "well") out.push(wind >= 74 ? "Confirm remote shut-in capability and subsea valve status." : "No action required; continue monitoring.");
	if (insideCone) out.push("Include in the twice-daily incident management team review while inside the impact corridor.");
	return out;
}
//#endregion
//#region node_modules/@tanstack/start-server-core/dist/esm/createSsrRpc.js
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/lib/services/azure/server.ts
/**
* Acquire a Managed Identity access token for a resource. On Azure App Service
* (and Container Apps) the platform injects IDENTITY_ENDPOINT / IDENTITY_HEADER;
* we fall back to the IMDS endpoint for VMs. No SDK, no secrets — the identity is
* the site's system-assigned managed identity, granted data-plane roles in
* main.bicep.
*/
/**
* Browse the tenant's GeoCatalog STAC collections and present them as operator-
* facing geospatial layers. Returns [] when the catalog is empty or unreachable
* — never synthetic layers.
*/
var listStacLayers = createServerFn({ method: "GET" }).handler(createSsrRpc("03cddc5147d0e9816c3e8ab7d85699f7b4f7bbd518bd559f75f6defaa4f3e893"));
/**
* Grounded operations assistant backed by Azure OpenAI (Foundry). When the
* endpoint is not configured it returns an honest "not configured" answer rather
* than a canned demo response.
*/
var askFoundryCopilot = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("b53cf893a408a20290cf0a85d5bddcbc104de59093038d2a89b7db0e386648be"));
/** Report which onboarding capabilities the current deployment has wired. */
var getDataPlaneStatus = createServerFn({ method: "GET" }).handler(createSsrRpc("3cd368cd0507e1d911d995db2ca3a86e6f4b382df40a8b320afea97bbee49eab"));
/**
* True when the Aurora post-processing job has published a recent weather-events
* blob to the model-outputs container. This is the honest runtime signal that the
* grid-to-WeatherEvent adapter is not just implemented but actually producing
* output — a stale or missing file reports the adapter as not connected.
*/
/** Load storm objects produced by the Aurora post-processing job. */
var listAuroraWeatherEvents = createServerFn({ method: "GET" }).handler(createSsrRpc("e3b4f51803f9911f3b5f27ab102846a358cf1bee7de94351f8b7f033aad0b6f4"));
/**
* Upload a file to the tenant's sample-assets container using the App Service
* managed identity (Storage Blob Data Contributor, granted in main.bicep). The
* browser sends base64 through the server-function boundary; no account key or
* SAS ever reaches the client.
*/
var uploadAsset = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("967f82a7bd2088d05660e3e561a1566764e9ea6f4f71d736f68ed1ef1ebdbb9f"));
/** Minimal RFC-4180-style CSV line splitter (handles double-quoted fields). */
/**
* List every CSV / GeoJSON the operator uploaded to the sample-assets container
* and parse them into the domain Asset shape. This is what turns an upload into a
* populated map + risk score. Later files (and later rows) win on duplicate id.
*/
var listUploadedAssets = createServerFn({ method: "GET" }).handler(createSsrRpc("359d8c3a63904b0daddf1be68920c4d80b8517d7286f0d3b8a5717b58121d831"));
/**
* Pre-seed the tenant GeoCatalog with a small public sample so a fresh
* deployment isn't empty: pull a few low-cloud Sentinel-2 scenes over the Gulf
* of Mexico from the open Planetary Computer, create a collection in the tenant
* catalog, and ingest the items via the STAC transaction API (GeoCatalog
* Administrator, granted in main.bicep). Public imagery only — never customer data.
*/
var seedPublicSample = createServerFn({ method: "POST" }).handler(createSsrRpc("40dc928b3bac3d2d9ca0c34bea9881550ac5c1ecde1550bf5b2e0f4ef3b613c3"));
/** Read a JSON app-config blob, or null when missing / storage unwired. */
/**
* Write a JSON app-config blob. Returns persisted:false (not an error) when
* storage is unwired so local dev keeps working in-memory; ok:false only on a
* real storage failure the caller should surface to the operator.
*/
/** Load persisted threshold rules, or null when none are stored / storage unwired. */
var loadThresholdRules = createServerFn({ method: "GET" }).handler(createSsrRpc("85f14038bbfb21b031f1b3511a747df79f23f2b2b16b291f222dc854899293b4"));
/** Persist the full threshold-rule set to storage. */
var saveThresholdRules = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("7ada2eeee52807a7a2ff5e8eabf9a7f9643edfdc7c6c9f82763ac1313c0c85df"));
/** Load persisted posture overrides (gate + production-status changes). */
var loadPostureOverrides = createServerFn({ method: "GET" }).handler(createSsrRpc("8991a6de2e4d2c79b6a9a3c2e73abfd33600ebdb2ccba44cfe98fa8fdaf66a91"));
/** Persist the full posture-override set. */
var savePostureOverrides = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("9918b4b9814c328fb063f5fcbd02096e5bc7bce5cc784bff85bdc58db6e0b53a"));
/** Load persisted alert status overrides. */
var loadAlertStatuses = createServerFn({ method: "GET" }).handler(createSsrRpc("eb773e696a38b96370a22309303bd3a158c6824ee6812e69646078ea41de101c"));
/** Persist the full alert status-override map. */
var saveAlertStatuses = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("d2e1c3054c641463cc5a9043ed814e299660c443de1956fc653e98ad333133c3"));
//#endregion
//#region src/lib/services/azure/providers.ts
/** Geospatial layers from the tenant's GeoCatalog STAC collections. */
var AzurePlanetaryComputerService = class {
	listLayers() {
		return listStacLayers();
	}
};
/** Grounded assistant backed by Azure OpenAI (Foundry) via managed identity. */
var AzureCopilotService = class {
	suggestions() {
		return [
			"Which assets are most at risk over the next 72 hours?",
			"Summarize current exposure for leadership.",
			"What changed since the previous forecast cycle?"
		];
	}
	ask(question) {
		return askFoundryCopilot({ data: { question } });
	}
};
/**
* Tenant assets. Bind this to your asset master (STAC items / Blob / Fabric).
* Until the customer ingests their estate this is empty by design.
*/
var AzureAssetService = class {
	async listAssets() {
		return listUploadedAssets();
	}
	async getAsset(id) {
		return (await listUploadedAssets()).find((a) => a.id === id) ?? null;
	}
};
/** Forecasts normalized by the Aurora post-processing job and persisted in Blob Storage. */
var AzureWeatherService = class {
	providerLabel = "Aurora / ECMWF (Planetary Computer Pro)";
	listEvents() {
		return listAuroraWeatherEvents();
	}
	async getEvent(id) {
		return (await listAuroraWeatherEvents()).find((event) => event.id === id) ?? null;
	}
};
function highestRiskFor(asset, events, horizonHours) {
	if (events.length === 0) return null;
	return events.map((event) => scoreAsset(asset, event, horizonHours)).reduce((highest, risk) => risk.score > highest.score ? risk : highest);
}
/** Risk is computed from the tenant's real assets and forecasts; no assets → no risks. */
var AzureRiskEngineService = class {
	async scoreEstate(horizonHours = 120) {
		const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
		return assets.flatMap((asset) => {
			const risk = highestRiskFor(asset, events, horizonHours);
			return risk ? [risk] : [];
		});
	}
	async scoreOne(assetId, horizonHours = 120) {
		const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
		const asset = assets.find((candidate) => candidate.id === assetId);
		return asset ? highestRiskFor(asset, events, horizonHours) : null;
	}
};
/**
* Alerts are derived from live threshold breaches in the view; this service owns
* their acknowledgement/resolution state, persisted as a map keyed by stable
* alert id so operator actions survive restarts and are shared across workers.
*/
var AzureAlertService = class {
	async listAlerts() {
		return [];
	}
	async listStatusOverrides() {
		return loadAlertStatuses();
	}
	async setStatus(id, status) {
		const result = await saveAlertStatuses({ data: { statuses: {
			...await loadAlertStatuses(),
			[id]: status
		} } });
		if (!result.ok) throw new Error(result.message);
		return [];
	}
};
/** Response posture derives from real exposure, with durable operator overrides. */
var AzurePostureService = class {
	async build(overrides) {
		const [assets, events] = await Promise.all([listUploadedAssets(), listAuroraWeatherEvents()]);
		return assets.map((asset) => {
			const base = derivePosture(asset, highestRiskFor(asset, events, 120) ?? void 0);
			return {
				...base,
				gates: {
					...base.gates,
					...overrides.gates[asset.id] ?? {}
				},
				productionStatus: overrides.status[asset.id] ?? base.productionStatus
			};
		});
	}
	async mutate(apply) {
		const next = apply(await loadPostureOverrides());
		const result = await savePostureOverrides({ data: { overrides: next } });
		if (!result.ok) throw new Error(result.message);
		return this.build(next);
	}
	async listPostures() {
		return this.build(await loadPostureOverrides());
	}
	async setGate(assetId, gate, state) {
		return this.mutate((o) => ({
			gates: {
				...o.gates,
				[assetId]: {
					...o.gates[assetId] ?? {},
					[gate]: state
				}
			},
			status: o.status
		}));
	}
	async setProductionStatus(assetId, status) {
		return this.mutate((o) => ({
			gates: o.gates,
			status: {
				...o.status,
				[assetId]: status
			}
		}));
	}
	async resetOverrides() {
		return this.mutate(() => ({
			gates: {},
			status: {}
		}));
	}
};
/**
* Threshold rules are operator configuration (not sample weather data). A fresh
* deployment starts from the built-in starter defaults; operator edits are
* persisted as a JSON blob in the deployment's storage container (see
* loadThresholdRules / saveThresholdRules) so tuned limits survive restarts.
* When storage is unwired (local dev) edits stay in memory for the session.
*/
var AzureThresholdService = class {
	rules = null;
	/** Load persisted rules once; fall back to built-in starter defaults. */
	async ensure() {
		if (this.rules) return this.rules;
		const stored = await loadThresholdRules();
		this.rules = stored && stored.length > 0 ? stored : DEFAULT_RULES.map((r) => ({ ...r }));
		return this.rules;
	}
	async persist(rules) {
		const result = await saveThresholdRules({ data: { rules } });
		if (!result.ok) throw new Error(result.message);
		this.rules = rules;
		return rules;
	}
	async listRules() {
		return this.ensure();
	}
	async saveRule(rule) {
		const rules = [...await this.ensure()];
		const i = rules.findIndex((r) => r.id === rule.id);
		if (i >= 0) rules[i] = rule;
		else rules.push(rule);
		return this.persist(rules);
	}
	async deleteRule(id) {
		const rules = (await this.ensure()).filter((r) => r.id !== id);
		return this.persist(rules);
	}
	async resetRules() {
		return this.persist(DEFAULT_RULES.map((r) => ({ ...r })));
	}
};
//#endregion
//#region src/lib/data/sample-gom.ts
var OP_MERIDIAN = "Meridian Energy";
var OP_GULFSTAR = "Gulfstar Offshore";
var OP_DELTA = "Delta Petroleum";
var OP_COASTAL = "Coastal LNG Partners";
var operators = [
	OP_MERIDIAN,
	OP_GULFSTAR,
	OP_DELTA,
	OP_COASTAL
];
function well(id, name, lat, lon, region, operator) {
	return {
		id,
		name,
		type: "well",
		lat,
		lon,
		operator,
		region,
		businessUnit: "Upstream",
		status: "producing",
		criticality: "standard",
		metadata: {
			water_depth_ft: 400 + Number(id.slice(-3)) * 137 % 4e3,
			completion: "subsea tieback"
		}
	};
}
var sampleAssets = [
	{
		id: "PLT-D7",
		name: "Platform Delta-7",
		type: "offshore_platform",
		lat: 27.62,
		lon: -90.35,
		operator: OP_MERIDIAN,
		region: "Central Gulf",
		businessUnit: "Deepwater Production",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			design_wind_mph: 130,
			production_boepd: 92e3,
			poB: 148,
			water_depth_ft: 5240
		}
	},
	{
		id: "PLT-M4",
		name: "Platform Mercury-4",
		type: "offshore_platform",
		lat: 28.41,
		lon: -89.42,
		operator: OP_MERIDIAN,
		region: "Mississippi Canyon",
		businessUnit: "Deepwater Production",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			design_wind_mph: 145,
			production_boepd: 61e3,
			poB: 96,
			water_depth_ft: 4100
		}
	},
	{
		id: "PLT-B2",
		name: "Facility Bravo-2",
		type: "offshore_platform",
		lat: 26.88,
		lon: -91.6,
		operator: OP_GULFSTAR,
		region: "Central Gulf",
		businessUnit: "Deepwater Production",
		status: "reduced",
		criticality: "important",
		metadata: {
			design_wind_mph: 120,
			production_boepd: 34e3,
			poB: 58,
			water_depth_ft: 3300
		}
	},
	{
		id: "PLT-A9",
		name: "Platform Atlas-9",
		type: "offshore_platform",
		lat: 28.05,
		lon: -92.4,
		operator: OP_GULFSTAR,
		region: "Western Gulf",
		businessUnit: "Shelf Production",
		status: "producing",
		criticality: "important",
		metadata: {
			design_wind_mph: 115,
			production_boepd: 18500,
			poB: 41,
			water_depth_ft: 620
		}
	},
	{
		id: "PLT-K3",
		name: "Platform Kestrel-3",
		type: "offshore_platform",
		lat: 26.1,
		lon: -93.2,
		operator: OP_DELTA,
		region: "Western Gulf",
		businessUnit: "Shelf Production",
		status: "standby",
		criticality: "standard",
		metadata: {
			design_wind_mph: 110,
			production_boepd: 7200,
			poB: 22,
			water_depth_ft: 410
		}
	},
	{
		id: "PLT-T1",
		name: "Platform Titan-1",
		type: "offshore_platform",
		lat: 27.05,
		lon: -88.7,
		operator: OP_MERIDIAN,
		region: "Eastern Gulf",
		businessUnit: "Deepwater Production",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			design_wind_mph: 155,
			production_boepd: 11e4,
			poB: 176,
			water_depth_ft: 6100
		}
	},
	{
		id: "RIG-N5",
		name: "Drillship Nautilus-5",
		type: "offshore_platform",
		lat: 27.9,
		lon: -90.9,
		operator: OP_GULFSTAR,
		region: "Central Gulf",
		businessUnit: "Drilling",
		status: "producing",
		criticality: "important",
		metadata: {
			design_wind_mph: 100,
			poB: 132,
			operation: "riser running"
		}
	},
	{
		id: "REF-PA1",
		name: "Port Arthur Refinery",
		type: "refinery",
		lat: 29.87,
		lon: -93.93,
		operator: OP_DELTA,
		region: "Texas Coast",
		businessUnit: "Downstream",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			capacity_bpd: 61e4,
			flood_elevation_ft: 12
		}
	},
	{
		id: "REF-BR2",
		name: "Baton Rouge Refinery",
		type: "refinery",
		lat: 30.48,
		lon: -91.19,
		operator: OP_DELTA,
		region: "Louisiana",
		businessUnit: "Downstream",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			capacity_bpd: 502e3,
			flood_elevation_ft: 22
		}
	},
	{
		id: "LNG-SAB",
		name: "Sabine Pass LNG Terminal",
		type: "lng_terminal",
		lat: 29.74,
		lon: -93.87,
		operator: OP_COASTAL,
		region: "Texas Coast",
		businessUnit: "LNG",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			trains: 6,
			storm_surge_design_ft: 18
		}
	},
	{
		id: "LNG-CAM",
		name: "Cameron LNG Terminal",
		type: "lng_terminal",
		lat: 29.86,
		lon: -93.32,
		operator: OP_COASTAL,
		region: "Louisiana",
		businessUnit: "LNG",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			trains: 3,
			storm_surge_design_ft: 16
		}
	},
	{
		id: "STO-CLK",
		name: "Clovelly Storage Hub",
		type: "storage",
		lat: 29.48,
		lon: -90.29,
		operator: OP_MERIDIAN,
		region: "Louisiana",
		businessUnit: "Midstream",
		status: "producing",
		criticality: "important",
		metadata: { capacity_bbl: 102e5 }
	},
	{
		id: "POR-FOU",
		name: "Port Fourchon Base",
		type: "port",
		lat: 29.11,
		lon: -90.2,
		operator: OP_MERIDIAN,
		region: "Louisiana",
		businessUnit: "Logistics",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			berths: 14,
			supply_vessels: 26
		}
	},
	{
		id: "POR-GAL",
		name: "Galveston Marine Terminal",
		type: "port",
		lat: 29.31,
		lon: -94.79,
		operator: OP_GULFSTAR,
		region: "Texas Coast",
		businessUnit: "Logistics",
		status: "producing",
		criticality: "important",
		metadata: {
			berths: 8,
			supply_vessels: 11
		}
	},
	{
		id: "PIP-GOM12",
		name: "Pipeline Segment GOM-12",
		type: "pipeline",
		lat: 28.35,
		lon: -90.5,
		geometry: [
			[-91.2, 27.4],
			[-90.8, 28],
			[-90.5, 28.6],
			[-90.3, 29.2]
		],
		operator: OP_MERIDIAN,
		region: "Central Gulf",
		businessUnit: "Midstream",
		status: "producing",
		criticality: "business_critical",
		metadata: {
			diameter_in: 30,
			length_mi: 148,
			throughput_bpd: 42e4
		}
	},
	{
		id: "PIP-GOM04",
		name: "Pipeline Segment GOM-04",
		type: "pipeline",
		lat: 28.6,
		lon: -92.1,
		geometry: [
			[-92.9, 27.8],
			[-92.4, 28.4],
			[-92, 29],
			[-93.4, 29.6]
		],
		operator: OP_GULFSTAR,
		region: "Western Gulf",
		businessUnit: "Midstream",
		status: "producing",
		criticality: "important",
		metadata: {
			diameter_in: 24,
			length_mi: 176,
			throughput_bpd: 21e4
		}
	},
	{
		id: "PIP-EAG7",
		name: "Pipeline Segment Eagle-7",
		type: "pipeline",
		lat: 29.6,
		lon: -91.6,
		geometry: [
			[-90.3, 29.3],
			[-91.4, 29.6],
			[-92.6, 29.8],
			[-93.9, 29.9]
		],
		operator: OP_DELTA,
		region: "Louisiana",
		businessUnit: "Midstream",
		status: "producing",
		criticality: "important",
		metadata: {
			diameter_in: 36,
			length_mi: 232,
			throughput_bpd: 54e4
		}
	}
];
var WELL_NAMES = [
	"Marlin",
	"Cobia",
	"Tarpon",
	"Amberjack",
	"Wahoo",
	"Bonito"
];
var wellSeeds = [];
for (let i = 0; i < 169; i++) {
	const a = i * 2.399963 % (Math.PI * 2);
	const rad = Math.sqrt(i % 43 / 43);
	const c = [
		[
			27.6,
			-91.4,
			1.6
		],
		[
			28.6,
			-88.9,
			1.3
		],
		[
			27.2,
			-94.4,
			1.5
		],
		[
			30.1,
			-95.4,
			1.1
		],
		[
			30.5,
			-92.2,
			1
		]
	][i % 5];
	wellSeeds.push([c[0] + Math.sin(a) * rad * c[2], c[1] + Math.cos(a) * rad * c[2] * 1.4]);
}
wellSeeds.forEach(([lat, lon], i) => {
	sampleAssets.push(well(`WEL-${String(i + 1).padStart(3, "0")}`, `Well ${WELL_NAMES[i % WELL_NAMES.length] ?? "Marlin"}-${i + 1}`, Number(lat.toFixed(3)), Number(lon.toFixed(3)), lon < -92 ? "Western Gulf" : lon < -89.5 ? "Central Gulf" : "Eastern Gulf", operators[i % operators.length] ?? OP_MERIDIAN));
});
var sampleEvent = {
	id: "AL072026",
	name: "Hurricane Gabrielle",
	kind: "hurricane",
	status: "Major hurricane — Category 3",
	basin: "Atlantic / Gulf of Mexico",
	currentCategory: 3,
	currentWindMph: 121,
	gustMph: 149,
	pressureMb: 954,
	movementDeg: 315,
	movementMph: 12,
	lat: 24.4,
	lon: -86.2,
	confidence: "high",
	modelSource: "Blended global forecast ensemble",
	updatedAtIso: (/* @__PURE__ */ new Date(Date.now() - 24e4)).toISOString(),
	expectedLandfall: "Central Louisiana coast, ~68 hours",
	history: [
		[-80.4, 20.1],
		[-82.1, 21.3],
		[-83.7, 22.4],
		[-85, 23.5],
		[-86.2, 24.4]
	],
	forecast: [
		{
			hour: 0,
			lat: 24.4,
			lon: -86.2,
			windMph: 121,
			coneRadiusMi: 0,
			category: 3,
			pressureMb: 954
		},
		{
			hour: 12,
			lat: 25.3,
			lon: -87.3,
			windMph: 127,
			coneRadiusMi: 42,
			category: 3,
			pressureMb: 949
		},
		{
			hour: 24,
			lat: 26.2,
			lon: -88.4,
			windMph: 133,
			coneRadiusMi: 74,
			category: 4,
			pressureMb: 941
		},
		{
			hour: 36,
			lat: 27,
			lon: -89.5,
			windMph: 138,
			coneRadiusMi: 104,
			category: 4,
			pressureMb: 936
		},
		{
			hour: 48,
			lat: 27.9,
			lon: -90.4,
			windMph: 131,
			coneRadiusMi: 138,
			category: 4,
			pressureMb: 942
		},
		{
			hour: 72,
			lat: 29.3,
			lon: -91.4,
			windMph: 112,
			coneRadiusMi: 196,
			category: 2,
			pressureMb: 958
		},
		{
			hour: 96,
			lat: 30.6,
			lon: -92.1,
			windMph: 68,
			coneRadiusMi: 244,
			category: 0,
			pressureMb: 985
		},
		{
			hour: 120,
			lat: 31.8,
			lon: -92.5,
			windMph: 40,
			coneRadiusMi: 288,
			category: 0,
			pressureMb: 999
		}
	]
};
var now = Date.now();
var sampleAlerts = [
	{
		id: "ALR-1041",
		title: "Platform Delta-7 entered high-risk storm corridor",
		detail: "Latest forecast places Delta-7 34 miles from the predicted centerline with 91 mph sustained winds at hour 29.",
		severity: "critical",
		assetId: "PLT-D7",
		eventId: "AL072026",
		status: "open",
		owner: "GoM Operations Duty Manager",
		createdAtIso: (/* @__PURE__ */ new Date(now - 132e4)).toISOString()
	},
	{
		id: "ALR-1040",
		title: "Pipeline Segment GOM-12 forecast for severe rainfall within 18 hours",
		detail: "Forecast rainfall of 8.4 in over the shore approach may affect right-of-way access and pigging schedule.",
		severity: "warning",
		assetId: "PIP-GOM12",
		eventId: "AL072026",
		status: "open",
		owner: "Midstream Integrity",
		createdAtIso: (/* @__PURE__ */ new Date(now - 384e4)).toISOString()
	},
	{
		id: "ALR-1039",
		title: "Wind forecast for Facility Bravo-2 exceeded configured threshold",
		detail: "Configured threshold 74 mph; forecast peak 88 mph at hour 41. Crane operations suspension recommended.",
		severity: "warning",
		assetId: "PLT-B2",
		eventId: "AL072026",
		status: "acknowledged",
		owner: "Offshore Marine Assurance",
		createdAtIso: (/* @__PURE__ */ new Date(now - 108e5)).toISOString()
	},
	{
		id: "ALR-1038",
		title: "Hurricane track updated",
		detail: "Track shifted 21 miles west of the previous cycle; central Gulf exposure increased.",
		severity: "advisory",
		eventId: "AL072026",
		status: "open",
		owner: "Meteorology Watch",
		createdAtIso: (/* @__PURE__ */ new Date(now - 144e5)).toISOString()
	},
	{
		id: "ALR-1037",
		title: "Port Fourchon Base staging capacity constrained",
		detail: "Evacuation demand modelling indicates berth saturation if more than four facilities de-man simultaneously.",
		severity: "advisory",
		assetId: "POR-FOU",
		status: "open",
		owner: "Logistics Control",
		createdAtIso: (/* @__PURE__ */ new Date(now - 252e5)).toISOString()
	},
	{
		id: "ALR-1036",
		title: "Drillship Nautilus-5 riser disconnect decision window opens in 12 hours",
		detail: "Forecast sea state exceeds operating envelope from hour 34.",
		severity: "warning",
		assetId: "RIG-N5",
		eventId: "AL072026",
		status: "open",
		owner: "Drilling Superintendent",
		createdAtIso: (/* @__PURE__ */ new Date(now - 324e5)).toISOString()
	},
	{
		id: "ALR-1035",
		title: "Sabine Pass LNG Terminal surge watch issued",
		detail: "Forecast surge 6.2 ft against 18 ft design; monitoring only at this time.",
		severity: "info",
		assetId: "LNG-SAB",
		status: "resolved",
		owner: "LNG Operations",
		createdAtIso: (/* @__PURE__ */ new Date(now - 936e5)).toISOString()
	}
];
sampleEvent.cycleId = "18Z cycle";
sampleEvent.ensemble = Array.from({ length: 14 }, (_, m) => {
	const bias = (m - 6.5) / 6.5;
	const speedBias = 1 + (m % 5 - 2) * .055;
	return {
		id: `ENS-${String(m + 1).padStart(2, "0")}`,
		label: `Member ${m + 1}`,
		track: sampleEvent.forecast.map((p) => {
			const spread = Math.pow(p.hour / 120, 1.35);
			const lat = p.lat + bias * spread * 2.4 * .62 + Math.sin(bias * 3.1) * spread * .5;
			const lon = p.lon - bias * spread * 3.6 + Math.cos(bias * 2.2) * spread * .45;
			const drift = (speedBias - 1) * spread * 2.1;
			return [Number((lon + drift).toFixed(3)), Number((lat + drift * .4).toFixed(3))];
		})
	};
});
sampleEvent.previousForecast = sampleEvent.forecast.map((p) => ({
	...p,
	lat: Number((p.lat - p.hour / 120 * .22).toFixed(3)),
	lon: Number((p.lon + p.hour / 120 * .62).toFixed(3)),
	windMph: Math.max(35, Math.round(p.windMph - (p.hour >= 24 && p.hour <= 72 ? 7 : 2))),
	coneRadiusMi: Math.round(p.coneRadiusMi * 1.07)
}));
sampleEvent.cycleShift = {
	currentCycle: "18Z cycle",
	previousCycle: "12Z cycle",
	shiftMi: 24,
	shiftBearingDeg: 288,
	shiftDirection: "west-northwest",
	intensityDeltaMph: 7,
	coneDeltaMi: -13,
	summary: "The 48-hour position moved 24 miles west-northwest of the 12Z cycle, peak intensity increased 7 mph and the 72-hour cone tightened by 13 miles. Central Gulf exposure increased; eastern Gulf exposure eased."
};
//#endregion
//#region src/lib/services/mock-providers.ts
var MockAssetService = class {
	async listAssets() {
		return sampleAssets;
	}
	async getAsset(id) {
		return sampleAssets.find((a) => a.id === id) ?? null;
	}
};
var MockWeatherService = class {
	providerLabel = "Blended global forecast ensemble";
	async listEvents() {
		return [sampleEvent];
	}
	async getEvent(id) {
		return id === sampleEvent.id ? sampleEvent : null;
	}
};
var MockRiskEngineService = class {
	async scoreEstate(horizonHours = 120) {
		return sampleAssets.map((a) => scoreAsset(a, sampleEvent, horizonHours));
	}
	async scoreOne(assetId, horizonHours = 120) {
		const asset = sampleAssets.find((a) => a.id === assetId);
		return asset ? scoreAsset(asset, sampleEvent, horizonHours) : null;
	}
};
var ALERT_STATUS_KEY = "ops-alert-status";
var MockAlertService = class {
	alerts = [...sampleAlerts];
	overrides = null;
	loadOverrides() {
		if (this.overrides) return this.overrides;
		if (typeof window !== "undefined") try {
			const raw = window.localStorage.getItem(ALERT_STATUS_KEY);
			if (raw) {
				this.overrides = JSON.parse(raw);
				return this.overrides;
			}
		} catch {}
		this.overrides = {};
		return this.overrides;
	}
	persistOverrides(next) {
		this.overrides = next;
		if (typeof window !== "undefined") try {
			window.localStorage.setItem(ALERT_STATUS_KEY, JSON.stringify(next));
		} catch {}
	}
	async listAlerts() {
		const o = this.loadOverrides();
		return this.alerts.map((a) => o[a.id] ? {
			...a,
			status: o[a.id]
		} : a);
	}
	async listStatusOverrides() {
		return this.loadOverrides();
	}
	async setStatus(id, status) {
		this.persistOverrides({
			...this.loadOverrides(),
			[id]: status
		});
		return this.listAlerts();
	}
};
var MockPlanetaryComputerService = class {
	async listLayers() {
		return [
			{
				id: "assets",
				name: "Company assets",
				description: "Platforms, pipelines, wells, terminals and ports",
				updatedLabel: "Synced 6 minutes ago",
				defaultOn: true
			},
			{
				id: "track",
				name: "Storm track & forecast cone",
				description: "Observed track and projected impact corridor",
				updatedLabel: "Updated 4 minutes ago",
				defaultOn: true
			},
			{
				id: "wind",
				name: "Severe wind field",
				description: "Hurricane and tropical-storm force wind extents",
				updatedLabel: "Updated 4 minutes ago",
				defaultOn: true
			},
			{
				id: "uncertainty",
				name: "Forecast spread (ensemble)",
				description: "Alternative storm paths from the forecast ensemble — how much the track could still change",
				updatedLabel: "Updated 4 minutes ago",
				defaultOn: true
			},
			{
				id: "previous",
				name: "Previous forecast cycle",
				description: "Where the last cycle put the storm, for cycle-over-cycle comparison",
				updatedLabel: "Superseded 6 hours ago",
				defaultOn: false
			},
			{
				id: "rain",
				name: "Rainfall accumulation",
				description: "72-hour forecast rainfall totals",
				updatedLabel: "Updated 11 minutes ago",
				defaultOn: false
			},
			{
				id: "flood",
				name: "Coastal flood exposure",
				description: "Surge and low-lying terrain exposure along the coast",
				updatedLabel: "Updated 38 minutes ago",
				defaultOn: false
			},
			{
				id: "satellite",
				name: "Satellite imagery — Gulf of Mexico",
				description: "Latest cloud-free composite of the operating region",
				updatedLabel: "Captured 2 hours ago",
				defaultOn: false
			},
			{
				id: "history",
				name: "Historical storm tracks",
				description: "Named storms crossing the estate since 1998",
				updatedLabel: "Reference dataset",
				defaultOn: false
			}
		];
	}
};
/**
* Grounded rules-based copilot. Answers are computed from live asset, forecast
* and risk state — the same grounding contract an Azure AI Foundry agent will
* use when it replaces this provider.
*/
var MockCopilotService = class {
	suggestions() {
		return [
			"Which offshore platforms are most at risk over the next 72 hours?",
			"When is Platform Delta-7 expected to experience hurricane-force winds?",
			"Show pipelines inside the current storm-impact corridor.",
			"Which assets should operations teams review first?",
			"Summarize Gulf of Mexico risk for leadership.",
			"Show the assets within 100 miles of the hurricane track.",
			"What changed between the latest forecast and the previous forecast?"
		];
	}
	async ask(question) {
		const q = question.toLowerCase();
		const risks = sampleAssets.map((a) => scoreAsset(a, sampleEvent, 120));
		const byId = new Map(risks.map((r) => [r.assetId, r]));
		const asset = sampleAssets.find((a) => q.includes(a.name.toLowerCase()) || q.includes(a.id.toLowerCase()));
		const ranked = [...risks].sort((a, b) => b.score - a.score);
		const nameOf = (id) => sampleAssets.find((a) => a.id === id)?.name ?? id;
		if (asset) {
			const r = byId.get(asset.id);
			const hurricaneForce = r.forecastWindMph >= 74;
			return {
				text: `**${asset.name}** — risk ${r.level.toUpperCase()} (${r.score}/100).\n\nClosest approach to ${sampleEvent.name} is **${r.distanceMi} miles** in **${r.hoursToImpact ?? "—"} hours**, with a forecast sustained wind of **${r.forecastWindMph} mph** and **${r.rainfallIn} in** of rainfall. ` + (hurricaneForce ? `Hurricane-force wind (74 mph+) is expected to reach the facility around hour **${Math.max(0, (r.hoursToImpact ?? 0) - 6)}**, ahead of peak intensity.` : `Hurricane-force wind is not currently forecast at this location.`) + `\n\nRecommended: ${r.recommendations[0] ?? "Continue monitoring."}`,
				citations: [
					{
						label: asset.name,
						kind: "asset",
						refId: asset.id
					},
					{
						label: sampleEvent.name,
						kind: "event",
						refId: sampleEvent.id
					},
					{
						label: `Risk score ${r.score}/100`,
						kind: "risk",
						refId: asset.id
					}
				],
				highlightAssetIds: [asset.id]
			};
		}
		if (q.includes("pipeline")) {
			const pipes = ranked.filter((r) => sampleAssets.find((a) => a.id === r.assetId)?.type === "pipeline" && r.insideCone);
			return {
				text: pipes.length === 0 ? "No pipeline segments are currently inside the projected impact corridor." : `**${pipes.length} pipeline segment${pipes.length > 1 ? "s" : ""}** lie inside the projected impact corridor:\n\n` + pipes.map((p) => `- **${nameOf(p.assetId)}** — ${p.score}/100, ${p.distanceMi} mi from the centerline, ${p.rainfallIn} in rainfall forecast, impact in ${p.hoursToImpact} h`).join("\n"),
				citations: [{
					label: "Impact corridor intersection",
					kind: "dataset"
				}],
				highlightAssetIds: pipes.map((p) => p.assetId)
			};
		}
		if (q.includes("100 mile") || q.includes("100 miles") || q.includes("within")) {
			const near = ranked.filter((r) => r.distanceMi <= 100);
			return {
				text: `**${near.length} assets** fall within 100 miles of the forecast track of ${sampleEvent.name}. The most exposed are:\n\n` + near.slice(0, 6).map((r) => `- **${nameOf(r.assetId)}** — ${r.distanceMi} mi, ${r.forecastWindMph} mph, risk ${r.score}/100`).join("\n"),
				citations: [{
					label: "Track proximity analysis",
					kind: "dataset"
				}],
				highlightAssetIds: near.map((r) => r.assetId)
			};
		}
		if (q.includes("chang") || q.includes("previous forecast")) return {
			text: "The latest forecast cycle shifted the track **21 miles west** of the previous cycle and raised peak intensity from Category 3 to **Category 4** near hour 36.\n\n- Central Gulf exposure increased: **Platform Delta-7** moved from elevated to **critical**.\n- **Platform Atlas-9** entered the corridor for the first time.\n- Eastern Gulf exposure eased slightly for **Platform Titan-1**.\n- First expected impact moved forward by roughly **3 hours**.",
			citations: [{
				label: "Forecast cycle comparison",
				kind: "dataset"
			}, {
				label: sampleEvent.name,
				kind: "event",
				refId: sampleEvent.id
			}],
			highlightAssetIds: ["PLT-D7", "PLT-A9"]
		};
		if (q.includes("leadership") || q.includes("summar") || q.includes("executive")) {
			const exposed = ranked.filter((r) => r.score >= 42);
			const inCone = ranked.filter((r) => r.insideCone);
			const first = ranked.filter((r) => r.hoursToImpact !== null).sort((a, b) => a.hoursToImpact - b.hoursToImpact)[0];
			return {
				text: `**Gulf of Mexico — leadership summary**\n\n${sampleEvent.name} is forecast to enter the central Gulf within 48 hours as a Category 4 system. **${exposed.length} assets** currently carry elevated risk or higher and **${inCone.length}** lie inside the projected impact corridor. First expected impact is in **${first?.hoursToImpact ?? "—"} hours**.\n\nHighest exposure: ${ranked.slice(0, 3).map((r) => `**${nameOf(r.assetId)}** (${r.score}/100)`).join(", ")}. Production at risk is concentrated in deepwater assets; downstream and LNG facilities remain in a monitoring posture pending the coastal track solution.`,
				citations: [{
					label: `${exposed.length} exposed assets`,
					kind: "risk"
				}, {
					label: sampleEvent.name,
					kind: "event",
					refId: sampleEvent.id
				}],
				highlightAssetIds: ranked.slice(0, 6).map((r) => r.assetId)
			};
		}
		const top = (q.includes("platform") || q.includes("offshore") ? ranked.filter((r) => sampleAssets.find((a) => a.id === r.assetId)?.type === "offshore_platform") : ranked).slice(0, 5);
		return {
			text: `Ranked by current 72-hour exposure to ${sampleEvent.name}:\n\n` + top.map((r, i) => `${i + 1}. **${nameOf(r.assetId)}** — ${r.level.toUpperCase()} ${r.score}/100 · ${r.distanceMi} mi from centerline · ${r.forecastWindMph} mph forecast · impact in ${r.hoursToImpact} h`).join("\n") + `\n\nReview order should follow this ranking; each entry has evacuation or shut-in lead time shorter than its forecast onset.`,
			citations: [{
				label: "Risk engine ranking",
				kind: "risk"
			}, {
				label: sampleEvent.name,
				kind: "event",
				refId: sampleEvent.id
			}],
			highlightAssetIds: top.map((r) => r.assetId)
		};
	}
};
function nearbyAssets(asset, all, radiusMi = 60) {
	return all.filter((a) => a.id !== asset.id).map((a) => ({
		a,
		d: haversineMi(asset.lat, asset.lon, a.lat, a.lon)
	})).filter((x) => x.d <= radiusMi).sort((x, y) => x.d - y.d).slice(0, 6).map((x) => x.a);
}
/**
* Response-posture provider. Posture is derived from live exposure, with
* operator overrides layered on top — the same contract a workflow system
* (Fabric / Dataverse) will honour when it replaces this provider.
*/
var MockPostureService = class {
	gateOverrides = /* @__PURE__ */ new Map();
	statusOverrides = /* @__PURE__ */ new Map();
	build() {
		const risks = new Map(sampleAssets.map((a) => [a.id, scoreAsset(a, sampleEvent, 120)]));
		return sampleAssets.map((a) => {
			const base = derivePosture(a, risks.get(a.id));
			const gates = {
				...base.gates,
				...this.gateOverrides.get(a.id) ?? {}
			};
			const status = this.statusOverrides.get(a.id) ?? base.productionStatus;
			return {
				...base,
				gates,
				productionStatus: status
			};
		});
	}
	async listPostures() {
		return this.build();
	}
	async setGate(assetId, gate, state) {
		const current = this.gateOverrides.get(assetId) ?? {};
		this.gateOverrides.set(assetId, {
			...current,
			[gate]: state
		});
		return this.build();
	}
	async setProductionStatus(assetId, status) {
		this.statusOverrides.set(assetId, status);
		return this.build();
	}
	async resetOverrides() {
		this.gateOverrides.clear();
		this.statusOverrides.clear();
		return this.build();
	}
};
var RULE_STORAGE_KEY = "ops-threshold-rules";
/** Threshold rules persist locally so operator edits survive a reload. */
var MockThresholdService = class {
	rules = null;
	load() {
		if (this.rules) return this.rules;
		if (typeof window !== "undefined") try {
			const raw = window.localStorage.getItem(RULE_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed) && parsed.length) {
					this.rules = parsed;
					return parsed;
				}
			}
		} catch {}
		this.rules = DEFAULT_RULES.map((r) => ({ ...r }));
		return this.rules;
	}
	persist(next) {
		this.rules = next;
		if (typeof window !== "undefined") try {
			window.localStorage.setItem(RULE_STORAGE_KEY, JSON.stringify(next));
		} catch {}
		return next;
	}
	async listRules() {
		return this.load();
	}
	async saveRule(rule) {
		const rules = this.load();
		const exists = rules.some((r) => r.id === rule.id);
		return this.persist(exists ? rules.map((r) => r.id === rule.id ? rule : r) : [...rules, rule]);
	}
	async deleteRule(id) {
		return this.persist(this.load().filter((r) => r.id !== id));
	}
	async resetRules() {
		return this.persist(DEFAULT_RULES.map((r) => ({ ...r })));
	}
};
new AzureAssetService(), new AzureWeatherService(), new AzureRiskEngineService(), new AzureAlertService(), new AzurePostureService(), new AzureThresholdService(), new AzurePlanetaryComputerService(), new AzureCopilotService();
var sampleServices = {
	assets: new MockAssetService(),
	weather: new MockWeatherService(),
	risk: new MockRiskEngineService(),
	alerts: new MockAlertService(),
	posture: new MockPostureService(),
	thresholds: new MockThresholdService(),
	geospatial: new MockPlanetaryComputerService(),
	copilot: new MockCopilotService()
};
/** Pick the provider set for the current console base. */
function getServices(_base) {
	return sampleServices;
}
//#endregion
//#region src/lib/hooks/use-ops-data.ts
function assetsQuery(base) {
	return queryOptions({
		queryKey: [base, "assets"],
		queryFn: () => getServices(base).assets.listAssets(),
		staleTime: 3e5
	});
}
function eventsQuery(base) {
	return queryOptions({
		queryKey: [base, "events"],
		queryFn: () => getServices(base).weather.listEvents(),
		staleTime: 6e4
	});
}
function layersQuery(base) {
	return queryOptions({
		queryKey: [base, "layers"],
		queryFn: () => getServices(base).geospatial.listLayers(),
		staleTime: 6e5
	});
}
function alertsQuery(base) {
	return queryOptions({
		queryKey: [base, "alerts"],
		queryFn: () => getServices(base).alerts.listAlerts(),
		staleTime: 3e4
	});
}
function alertStatusOverridesQuery(base) {
	return queryOptions({
		queryKey: [base, "alert-status-overrides"],
		queryFn: () => getServices(base).alerts.listStatusOverrides(),
		staleTime: 3e4
	});
}
function postureQuery(base) {
	return queryOptions({
		queryKey: [base, "posture"],
		queryFn: () => getServices(base).posture.listPostures(),
		staleTime: 3e4
	});
}
function thresholdRulesQuery(base) {
	return queryOptions({
		queryKey: [base, "threshold-rules"],
		queryFn: () => getServices(base).thresholds.listRules(),
		staleTime: 3e5
	});
}
function risksQuery(base, horizonHours) {
	return queryOptions({
		queryKey: [
			base,
			"risks",
			horizonHours
		],
		queryFn: () => getServices(base).risk.scoreEstate(horizonHours),
		staleTime: 6e4
	});
}
function useOpsSnapshot(base, horizonHours = 72) {
	const assets = useQuery(assetsQuery(base));
	const events = useQuery(eventsQuery(base));
	const risks = useQuery(risksQuery(base, horizonHours));
	return useMemo(() => {
		const a = assets.data ?? [];
		const r = risks.data ?? [];
		const riskMap = new Map(r.map((x) => [x.assetId, x]));
		const exposed = r.filter((x) => x.level !== "normal" && x.level !== "monitor");
		const impacts = r.filter((x) => x.hoursToImpact !== null && x.level !== "normal").map((x) => x.hoursToImpact).sort((x, y) => x - y);
		const highestRisk = r.reduce((highest, risk) => !highest || risk.score > highest.score ? risk : highest, void 0);
		return {
			assets: a,
			risks: r,
			riskMap,
			event: events.data?.find((event) => event.id === highestRisk?.eventId) ?? events.data?.[0],
			isLoading: assets.isLoading || risks.isLoading || events.isLoading,
			metrics: {
				monitored: a.length,
				exposed: exposed.length,
				insideCone: r.filter((x) => x.insideCone).length,
				high: r.filter((x) => x.level === "high").length,
				critical: r.filter((x) => x.level === "critical").length,
				firstImpactHours: impacts[0] ?? null
			}
		};
	}, [
		assets.data,
		assets.isLoading,
		risks.data,
		risks.isLoading,
		events.data,
		events.isLoading
	]);
}
//#endregion
export { OpsLink as C, PageHeader as S, cn as T, gateStateLabel as _, layersQuery as a, evaluateRules as b, useOpsSnapshot as c, getDataPlaneStatus as d, seedPublicSample as f, POSTURE_LEVEL_LABEL as g, POSTURE_GATES as h, eventsQuery as i, getServices as l, scoreAsset as m, alertsQuery as n, postureQuery as o, uploadAsset as p, assetsQuery as r, thresholdRulesQuery as s, alertStatusOverridesQuery as t, nearbyAssets as u, METRIC_LABEL as v, useOpsBase as w, AppShell as x, METRIC_UNIT as y };
