import { s as riskColorVar } from "./format-CGsoAMDh.js";
import { T as cn } from "./use-ops-data-B8Zw8Vry.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import * as maplibregl from "maplibre-gl";
import { Crosshair, Minus, Plus } from "lucide-react";
//#region node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url
var maplibre_gl_worker_default = "/assets/maplibre-gl-worker-DZ7nj4vd.js";
//#endregion
//#region src/lib/map/basemap.ts
var AZURE_KEY = {
	"BASE_URL": "/",
	"DEV": false,
	"MODE": "production",
	"PROD": true,
	"SSR": true,
	"TSS_DEV_SERVER": "false",
	"TSS_DEV_SSR_STYLES_BASEPATH": "/",
	"TSS_DEV_SSR_STYLES_ENABLED": "true",
	"TSS_DISABLE_CSRF_MIDDLEWARE_WARNING": "false",
	"TSS_INLINE_CSS_ENABLED": "false",
	"TSS_ROUTER_BASEPATH": "",
	"TSS_SERVER_FN_BASE": "/_serverFn/",
	"VITE_USE_SAMPLE_DATA": "true"
}["VITE_AZURE_MAPS_KEY"];
var ATTRIB_ESRI = "Imagery &copy; Esri, Maxar, Earthstar Geographics";
var ATTRIB_ESRI_OCEAN = "Bathymetry &copy; Esri, GEBCO, NOAA, National Geographic";
var ATTRIB_AZURE = "&copy; Microsoft, &copy; TomTom";
var ATTRIB_CARTO = "&copy; OpenStreetMap contributors, &copy; CARTO";
function rasterStyle(layers, attribution, background) {
	const sources = {};
	const styleLayers = [{
		id: "bg",
		type: "background",
		paint: { "background-color": background }
	}];
	layers.forEach((l, i) => {
		const id = `basemap-${i}`;
		sources[id] = {
			type: "raster",
			tiles: l.tiles,
			tileSize: 256,
			maxzoom: 19,
			attribution
		};
		styleLayers.push({
			id,
			type: "raster",
			source: id,
			paint: { "raster-opacity": l.opacity ?? 1 }
		});
	});
	return {
		version: 8,
		glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
		sources,
		layers: styleLayers
	};
}
/**
* A style is either a keyless vector style URL or a raster style spec.
* MapLibre accepts both in `new Map({ style })` and `map.setStyle()`.
*/
function basemapStyle(id) {
	if (id === "satellite") return rasterStyle([{ tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] }], ATTRIB_ESRI, "#0a1622");
	if (id === "bathymetry") return rasterStyle([{ tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"] }, {
		tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}"],
		opacity: .85
	}], ATTRIB_ESRI_OCEAN, "#0a1a26");
	if (AZURE_KEY) return rasterStyle([{ tiles: [`https://atlas.microsoft.com/map/tile?api-version=2024-04-01&tilesetId=microsoft.base.darkgrey&zoom={z}&x={x}&y={y}&tileSize=256&subscription-key=${AZURE_KEY}`] }], ATTRIB_AZURE, "#08111c");
	return rasterStyle([{ tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"] }], ATTRIB_CARTO, "#08111c");
}
var basemapProviderLabel = AZURE_KEY ? "Azure Maps" : "CARTO / OpenStreetMap";
//#endregion
//#region src/lib/map/geojson.ts
var EARTH_MI = 3958.8;
var R = Math.PI / 180;
/** Great-circle destination point from an origin, bearing (deg) and distance (mi). */
function destination(lon, lat, bearingDeg, miles) {
	const d = miles / EARTH_MI;
	const br = bearingDeg * R;
	const la1 = lat * R;
	const lo1 = lon * R;
	const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
	return [(lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))) / R, la2 / R];
}
function circlePolygon(lon, lat, miles, steps = 64) {
	const ring = [];
	for (let i = 0; i <= steps; i++) ring.push(destination(lon, lat, i * 360 / steps, miles));
	return {
		type: "Polygon",
		coordinates: [ring]
	};
}
/**
* NHC-style asymmetric wind-radii polygon: NE, SE, SW, NW radii in miles.
*/
function quadrantPolygon(lon, lat, quad, steps = 16) {
	const [ne = 0, se = 0, sw = 0, nw = 0] = quad;
	const at = (bearing) => {
		const b = (bearing % 360 + 360) % 360;
		const q = Math.floor(b / 90);
		const t = b % 90 / 90;
		const order = [
			ne,
			se,
			sw,
			nw
		];
		const a = order[q] ?? 0;
		const c = order[(q + 1) % 4] ?? 0;
		const w = (1 - Math.cos(t * Math.PI)) / 2;
		return a + (c - a) * w;
	};
	const total = steps * 4;
	const ring = [];
	for (let i = 0; i <= total; i++) {
		const bearing = i * 360 / total;
		ring.push(destination(lon, lat, bearing, at(bearing)));
	}
	return {
		type: "Polygon",
		coordinates: [ring]
	};
}
/**
* Forecast cone of uncertainty: circles of uncertainty swept along the track,
* joined on the segment normals, with a rounded cap at the final position.
*/
function conePolygon(points) {
	const pts = points.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
	if (pts.length < 2) return {
		type: "Polygon",
		coordinates: [[]]
	};
	const left = [];
	const right = [];
	for (let i = 0; i < pts.length; i++) {
		const prev = pts[Math.max(0, i - 1)];
		const next = pts[Math.min(pts.length - 1, i + 1)];
		const dx = (next.lon - prev.lon) * Math.cos(pts[i].lat * R);
		const dy = next.lat - prev.lat;
		const bearing = (Math.atan2(dx, dy) / R + 360) % 360;
		const p = pts[i];
		const r = Math.max(p.radiusMi, 8);
		left.push(destination(p.lon, p.lat, bearing - 90, r));
		right.unshift(destination(p.lon, p.lat, bearing + 90, r));
	}
	const last = pts[pts.length - 1];
	const lp = pts[pts.length - 2];
	const bx = (last.lon - lp.lon) * Math.cos(last.lat * R);
	const by = last.lat - lp.lat;
	const endBearing = (Math.atan2(bx, by) / R + 360) % 360;
	const cap = [];
	for (let a = -90; a <= 90; a += 15) cap.push(destination(last.lon, last.lat, endBearing + a, Math.max(last.radiusMi, 8)));
	const ring = [
		...left,
		...cap,
		...right
	];
	ring.push(ring[0]);
	return {
		type: "Polygon",
		coordinates: [ring]
	};
}
function feature(geometry, properties = {}) {
	return {
		type: "Feature",
		geometry,
		properties
	};
}
function empty() {
	return {
		type: "FeatureCollection",
		features: []
	};
}
//#endregion
//#region src/components/ops/GeoMap.tsx
if (typeof Worker !== "undefined") maplibregl.setWorkerUrl(maplibre_gl_worker_default);
var GULF_BOUNDS = [[-98.5, 17.5], [-79.5, 31.5]];
/**
* Resolve a design token to an rgb() string. MapLibre's style parser predates
* oklch(), so oklch tokens are converted to sRGB before they reach a layer.
*/
var colorCache = /* @__PURE__ */ new Map();
function oklchToRgb(l, c, hDeg) {
	const h = hDeg * Math.PI / 180;
	const a = c * Math.cos(h);
	const bb = c * Math.sin(h);
	const l_ = (l + .3963377774 * a + .2158037573 * bb) ** 3;
	const m_ = (l - .1055613458 * a - .0638541728 * bb) ** 3;
	const s_ = (l - .0894841775 * a - 1.291485548 * bb) ** 3;
	const srgb = [
		4.0767416621 * l_ - 3.3077115913 * m_ + .2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - .3413193965 * s_,
		-.0041960863 * l_ - .7034186147 * m_ + 1.707614701 * s_
	].map((v) => {
		const g = v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - .055;
		return Math.round(Math.min(255, Math.max(0, g * 255)));
	});
	return `rgb(${srgb[0]}, ${srgb[1]}, ${srgb[2]})`;
}
function toRgb(value, fallback) {
	const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
	if (m) return oklchToRgb(parseFloat(m[1]) / (m[2] ? 100 : 1), parseFloat(m[3]), parseFloat(m[4]));
	return /^(#|rgb|hsl)/i.test(value) ? value : fallback;
}
function token(name, fallback) {
	if (typeof window === "undefined") return fallback;
	const cached = colorCache.get(name);
	if (cached) return cached;
	const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	const resolved = raw ? toRgb(raw, fallback) : fallback;
	colorCache.set(name, resolved);
	return resolved;
}
function riskColor(level) {
	return token(riskColorVar(level ?? "normal").replace(/^var\(|\)$/g, ""), "rgb(100, 116, 139)");
}
function categoryColor(category, windMph) {
	if (category >= 5) return token("--color-cat5", "#f0abfc");
	if (category >= 4) return token("--color-cat4", "#f87171");
	if (category >= 3) return token("--color-cat3", "#fb923c");
	if (category >= 2) return token("--color-cat2", "#fbbf24");
	if (category >= 1) return token("--color-cat1", "#facc15");
	if (windMph >= 39) return token("--color-cat-ts", "#4ade80");
	return token("--color-cat-td", "#38bdf8");
}
function categoryLabel(category, windMph) {
	if (category >= 1) return `C${category}`;
	return windMph >= 39 ? "TS" : "TD";
}
function interpolatePosition(event, hour) {
	if (!event || event.forecast.length === 0) return null;
	const f = event.forecast;
	for (let i = 0; i < f.length - 1; i++) {
		const a = f[i];
		const b = f[i + 1];
		if (hour >= a.hour && hour <= b.hour) {
			const t = (hour - a.hour) / (b.hour - a.hour);
			return {
				lat: a.lat + (b.lat - a.lat) * t,
				lon: a.lon + (b.lon - a.lon) * t,
				windMph: Math.round(a.windMph + (b.windMph - a.windMph) * t),
				coneRadiusMi: a.coneRadiusMi + (b.coneRadiusMi - a.coneRadiusMi) * t,
				category: t < .5 ? a.category : b.category
			};
		}
	}
	return { ...f[f.length - 1] };
}
var RISK_RANK = {
	normal: 0,
	monitor: 1,
	elevated: 2,
	high: 3,
	critical: 4
};
var MAJOR_TYPES = /* @__PURE__ */ new Set([
	"refinery",
	"lng_terminal",
	"port",
	"storage",
	"offshore_platform"
]);
function GeoMap({ assets, risks, event, layers, catalogLayers = [], selectedId, highlightIds = [], hour = 0, onSelect, className }) {
	const containerRef = useRef(null);
	const mapRef = useRef(null);
	const [ready, setReady] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(0);
	const [cursor, setCursor] = useState(null);
	const [hovered, setHovered] = useState(null);
	const satellite = !!layers["satellite"];
	const [basemap, setBasemap] = useState("dark");
	const activeBasemap = satellite ? "satellite" : basemap;
	const selectRef = useRef(onSelect);
	selectRef.current = onSelect;
	const assetsRef = useRef(assets);
	assetsRef.current = assets;
	const pos = useMemo(() => interpolatePosition(event, hour), [event, hour]);
	const catalogData = useMemo(() => ({
		type: "FeatureCollection",
		features: catalogLayers.flatMap((layer) => layers[layer.id] ? (layer.data?.features ?? []).map((item) => ({
			...item,
			properties: {
				...item.properties,
				catalogCollection: layer.name
			}
		})) : [])
	}), [catalogLayers, layers]);
	const catalogBounds = useMemo(() => {
		const boxes = catalogData.features.map((item) => item.bbox).filter((bbox) => !!bbox && bbox.length >= 4);
		if (boxes.length === 0) return null;
		return [[Math.min(...boxes.map((bbox) => bbox[0])), Math.min(...boxes.map((bbox) => bbox[1]))], [Math.max(...boxes.map((bbox) => bbox[2])), Math.max(...boxes.map((bbox) => bbox[3]))]];
	}, [catalogData]);
	const defaultBoundsRef = useRef(GULF_BOUNDS);
	defaultBoundsRef.current = !event && catalogBounds ? catalogBounds : GULF_BOUNDS;
	const assetPoints = useMemo(() => {
		return {
			type: "FeatureCollection",
			features: assets.filter((a) => a.type !== "pipeline").slice().sort((a, b) => (RISK_RANK[risks.get(a.id)?.level ?? "normal"] ?? 0) - (RISK_RANK[risks.get(b.id)?.level ?? "normal"] ?? 0)).map((a) => {
				const r = risks.get(a.id);
				return feature({
					type: "Point",
					coordinates: [a.lon, a.lat]
				}, {
					id: a.id,
					name: a.name,
					type: a.type,
					major: MAJOR_TYPES.has(a.type) ? 1 : 0,
					color: riskColor(r?.level),
					score: r?.score ?? 0,
					rank: RISK_RANK[r?.level ?? "normal"] ?? 0,
					selected: selectedId === a.id ? 1 : 0,
					highlighted: highlightIds.includes(a.id) ? 1 : 0
				});
			})
		};
	}, [
		assets,
		risks,
		selectedId,
		highlightIds
	]);
	const pipelineLines = useMemo(() => {
		return {
			type: "FeatureCollection",
			features: assets.filter((a) => a.type === "pipeline" && a.geometry).map((a) => feature({
				type: "LineString",
				coordinates: a.geometry
			}, {
				id: a.id,
				name: a.name,
				color: riskColor(risks.get(a.id)?.level),
				selected: selectedId === a.id ? 1 : 0
			}))
		};
	}, [
		assets,
		risks,
		selectedId
	]);
	const trackData = useMemo(() => {
		if (!event) return {
			forecast: empty(),
			history: empty(),
			cone: empty(),
			points: empty()
		};
		const forecastCoords = event.forecast.map((p) => [p.lon, p.lat]);
		const forecastFeatures = forecastCoords.length >= 2 ? [feature({
			type: "LineString",
			coordinates: forecastCoords
		})] : [];
		const historyCoords = (event.history ?? []).filter((c) => Array.isArray(c) && c.length === 2);
		const historyFeatures = historyCoords.length >= 2 ? [feature({
			type: "LineString",
			coordinates: historyCoords
		})] : [];
		const coneFeatures = event.forecast.length >= 2 ? [feature(conePolygon(event.forecast.map((p) => ({
			lon: p.lon,
			lat: p.lat,
			radiusMi: p.coneRadiusMi
		}))))] : [];
		const points = event.forecast.map((p) => feature({
			type: "Point",
			coordinates: [p.lon, p.lat]
		}, {
			color: categoryColor(p.category, p.windMph),
			label: categoryLabel(p.category, p.windMph),
			detail: `+${p.hour}h · ${p.windMph} mph`
		}));
		return {
			forecast: {
				type: "FeatureCollection",
				features: forecastFeatures
			},
			history: {
				type: "FeatureCollection",
				features: historyFeatures
			},
			cone: {
				type: "FeatureCollection",
				features: coneFeatures
			},
			points: {
				type: "FeatureCollection",
				features: points
			}
		};
	}, [event]);
	/** Ensemble spread: each member's centerline, conveying track uncertainty. */
	const ensembleData = useMemo(() => {
		if (!event) return empty();
		return {
			type: "FeatureCollection",
			features: (event.ensemble ?? []).map((m) => feature({
				type: "LineString",
				coordinates: m.track
			}, { id: m.id }))
		};
	}, [event]);
	/** Previous forecast cycle, for cycle-over-cycle comparison. */
	const previousData = useMemo(() => {
		if (!event) return {
			line: empty(),
			cone: empty()
		};
		const prev = event.previousForecast ?? [];
		if (prev.length < 2) return {
			line: empty(),
			cone: empty()
		};
		return {
			line: {
				type: "FeatureCollection",
				features: [feature({
					type: "LineString",
					coordinates: prev.map((p) => [p.lon, p.lat])
				})]
			},
			cone: {
				type: "FeatureCollection",
				features: [feature(conePolygon(prev.map((p) => ({
					lon: p.lon,
					lat: p.lat,
					radiusMi: p.coneRadiusMi
				}))))]
			}
		};
	}, [event]);
	const windData = useMemo(() => {
		if (!pos) return empty();
		const scale = pos.windMph / 130;
		return {
			type: "FeatureCollection",
			features: [
				{
					kt: 64,
					quad: [
						68,
						58,
						40,
						48
					],
					color: token("--color-cat5", "#f0abfc"),
					opacity: .2
				},
				{
					kt: 50,
					quad: [
						125,
						105,
						78,
						92
					],
					color: token("--color-cat3", "#fb923c"),
					opacity: .14
				},
				{
					kt: 34,
					quad: [
						205,
						180,
						140,
						155
					],
					color: token("--color-cat1", "#facc15"),
					opacity: .1
				}
			].map((r) => feature(quadrantPolygon(pos.lon, pos.lat, r.quad.map((m) => m * scale)), {
				kt: r.kt,
				color: r.color,
				opacity: r.opacity
			})).reverse()
		};
	}, [pos]);
	const rainData = useMemo(() => ({
		type: "FeatureCollection",
		features: (event?.forecast ?? []).map((p) => feature(circlePolygon(p.lon, p.lat, 170, 40), { hour: p.hour }))
	}), [event]);
	const centerData = useMemo(() => ({
		type: "FeatureCollection",
		features: pos && event ? [feature({
			type: "Point",
			coordinates: [pos.lon, pos.lat]
		}, {
			name: event.name,
			wind: `${pos.windMph} mph`
		})] : []
	}), [pos, event]);
	const floodData = useMemo(() => {
		return {
			type: "FeatureCollection",
			features: assets.filter((a) => MAJOR_TYPES.has(a.type) && a.type !== "offshore_platform").map((a) => feature(circlePolygon(a.lon, a.lat, 22, 32)))
		};
	}, [assets]);
	const userMovedRef = useRef(false);
	useEffect(() => {
		if (!containerRef.current || mapRef.current) return;
		const container = containerRef.current;
		const map = new maplibregl.Map({
			container,
			style: basemapStyle(activeBasemap),
			bounds: defaultBoundsRef.current,
			fitBoundsOptions: { padding: 56 },
			attributionControl: false,
			dragRotate: false,
			maxZoom: 12,
			minZoom: 3,
			canvasContextAttributes: { preserveDrawingBuffer: true }
		});
		map.getCanvasContainer().style.height = "100%";
		map.touchZoomRotate.disableRotation();
		mapRef.current = map;
		setZoomLevel(map.getZoom());
		map.on("move", () => setZoomLevel(map.getZoom()));
		map.on("mousemove", (e) => setCursor({
			lon: e.lngLat.lng,
			lat: e.lngLat.lat
		}));
		map.on("mouseout", () => setCursor(null));
		map.on("load", () => {
			setReady(true);
			map.resize();
			if (!userMovedRef.current) map.fitBounds(defaultBoundsRef.current, {
				padding: 56,
				animate: false
			});
		});
		const markMoved = () => userMovedRef.current = true;
		map.on("dragstart", markMoved);
		map.on("wheel", markMoved);
		map.on("boxzoomstart", markMoved);
		const ro = new ResizeObserver(() => {
			if (!mapRef.current) return;
			map.resize();
			if (!userMovedRef.current) map.fitBounds(defaultBoundsRef.current, {
				padding: 56,
				animate: false
			});
		});
		ro.observe(container);
		return () => {
			ro.disconnect();
			map.remove();
			mapRef.current = null;
			setReady(false);
		};
	}, []);
	/** (Re)build every operational layer — also runs after a basemap style swap. */
	const buildRetryRef = useRef(null);
	const buildLayers = useCallback(() => {
		const map = mapRef.current;
		if (!map) return;
		if (!map.isStyleLoaded()) {
			map.once("idle", () => buildRetryRef.current?.());
			return;
		}
		const src = (id, data) => {
			const existing = map.getSource(id);
			if (existing) existing.setData(data);
			else map.addSource(id, {
				type: "geojson",
				data
			});
		};
		src("rain", empty());
		src("flood", empty());
		src("prev-cone", empty());
		src("ensemble", empty());
		src("prev-track", empty());
		src("cone", empty());
		src("wind", empty());
		src("history", empty());
		src("forecast", empty());
		src("track-points", empty());
		src("pipelines", empty());
		src("assets", empty());
		src("catalog-items", empty());
		src("storm-center", empty());
		const add = (layer) => {
			if (!map.getLayer(layer.id)) map.addLayer(layer);
		};
		add({
			id: "rain-fill",
			type: "fill",
			source: "rain",
			paint: {
				"fill-color": token("--color-rain", "#38bdf8"),
				"fill-opacity": .07
			}
		});
		add({
			id: "flood-fill",
			type: "fill",
			source: "flood",
			paint: {
				"fill-color": token("--color-flood", "#22d3ee"),
				"fill-opacity": .18
			}
		});
		add({
			id: "prev-cone-line",
			type: "line",
			source: "prev-cone",
			paint: {
				"line-color": token("--color-muted-foreground", "#94a3b8"),
				"line-opacity": .35,
				"line-width": 1,
				"line-dasharray": [2, 3]
			}
		});
		add({
			id: "ensemble-line",
			type: "line",
			source: "ensemble",
			paint: {
				"line-color": token("--color-cone", "#93c5fd"),
				"line-opacity": .32,
				"line-width": .9
			}
		});
		add({
			id: "prev-track-line",
			type: "line",
			source: "prev-track",
			paint: {
				"line-color": token("--color-muted-foreground", "#94a3b8"),
				"line-opacity": .75,
				"line-width": 1.6,
				"line-dasharray": [1, 2]
			}
		});
		add({
			id: "wind-fill",
			type: "fill",
			source: "wind",
			paint: {
				"fill-color": ["get", "color"],
				"fill-opacity": ["get", "opacity"]
			}
		});
		add({
			id: "wind-line",
			type: "line",
			source: "wind",
			paint: {
				"line-color": ["get", "color"],
				"line-opacity": .55,
				"line-width": 1
			}
		});
		add({
			id: "cone-fill",
			type: "fill",
			source: "cone",
			paint: {
				"fill-color": token("--color-cone", "#93c5fd"),
				"fill-opacity": .1
			}
		});
		add({
			id: "cone-line",
			type: "line",
			source: "cone",
			paint: {
				"line-color": token("--color-cone", "#93c5fd"),
				"line-opacity": .6,
				"line-width": 1.2,
				"line-dasharray": [4, 3]
			}
		});
		add({
			id: "history-line",
			type: "line",
			source: "history",
			paint: {
				"line-color": token("--color-muted-foreground", "#94a3b8"),
				"line-width": 2
			}
		});
		add({
			id: "forecast-line",
			type: "line",
			source: "forecast",
			paint: {
				"line-color": token("--color-track", "#e2e8f0"),
				"line-width": 2.4,
				"line-dasharray": [3, 2]
			}
		});
		add({
			id: "catalog-item-fill",
			type: "fill",
			source: "catalog-items",
			paint: {
				"fill-color": token("--color-primary", "#22d3ee"),
				"fill-opacity": .2
			}
		});
		add({
			id: "catalog-item-line",
			type: "line",
			source: "catalog-items",
			paint: {
				"line-color": token("--color-primary", "#22d3ee"),
				"line-opacity": .95,
				"line-width": 2
			}
		});
		add({
			id: "pipeline-casing",
			type: "line",
			source: "pipelines",
			paint: {
				"line-color": "#000000",
				"line-opacity": .55,
				"line-width": 5
			}
		});
		add({
			id: "pipeline-line",
			type: "line",
			source: "pipelines",
			paint: {
				"line-color": ["get", "color"],
				"line-width": [
					"case",
					[
						"==",
						["get", "selected"],
						1
					],
					4,
					2.2
				]
			}
		});
		add({
			id: "asset-halo",
			type: "circle",
			source: "assets",
			filter: [
				"any",
				[
					"==",
					["get", "selected"],
					1
				],
				[
					"==",
					["get", "highlighted"],
					1
				],
				[
					">=",
					["get", "rank"],
					4
				]
			],
			paint: {
				"circle-radius": 13,
				"circle-color": ["get", "color"],
				"circle-opacity": .16,
				"circle-stroke-color": ["get", "color"],
				"circle-stroke-width": 1.2,
				"circle-stroke-opacity": .8
			}
		});
		add({
			id: "asset-point",
			type: "circle",
			source: "assets",
			paint: {
				"circle-radius": [
					"interpolate",
					["linear"],
					["zoom"],
					4,
					[
						"case",
						[
							"==",
							["get", "major"],
							1
						],
						4.5,
						2.2
					],
					9,
					[
						"case",
						[
							"==",
							["get", "major"],
							1
						],
						8,
						4.5
					]
				],
				"circle-color": ["get", "color"],
				"circle-opacity": .95,
				"circle-stroke-color": "#04070d",
				"circle-stroke-width": 1
			}
		});
		add({
			id: "asset-label",
			type: "symbol",
			source: "assets",
			filter: [
				"any",
				[
					"==",
					["get", "major"],
					1
				],
				[
					"==",
					["get", "selected"],
					1
				]
			],
			layout: {
				"text-field": ["get", "name"],
				"text-font": ["Noto Sans Bold"],
				"text-size": 10,
				"text-offset": [.8, 0],
				"text-anchor": "left",
				"text-allow-overlap": false,
				"text-optional": true
			},
			paint: {
				"text-color": token("--color-foreground", "#e2e8f0"),
				"text-halo-color": "#04070d",
				"text-halo-width": 1.4
			}
		});
		add({
			id: "track-point",
			type: "circle",
			source: "track-points",
			paint: {
				"circle-radius": 7,
				"circle-color": ["get", "color"],
				"circle-stroke-color": "#04070d",
				"circle-stroke-width": 1.2
			}
		});
		add({
			id: "track-point-label",
			type: "symbol",
			source: "track-points",
			layout: {
				"text-field": ["get", "label"],
				"text-font": ["Noto Sans Bold"],
				"text-size": 9
			},
			paint: { "text-color": "#04070d" }
		});
		add({
			id: "track-point-detail",
			type: "symbol",
			source: "track-points",
			minzoom: 5,
			layout: {
				"text-field": ["get", "detail"],
				"text-font": ["Noto Sans Regular"],
				"text-size": 10,
				"text-offset": [0, -1.5]
			},
			paint: {
				"text-color": token("--color-muted-foreground", "#94a3b8"),
				"text-halo-color": "#04070d",
				"text-halo-width": 1.4
			}
		});
		add({
			id: "storm-center",
			type: "circle",
			source: "storm-center",
			paint: {
				"circle-radius": 9,
				"circle-color": token("--color-storm", "#ef4444"),
				"circle-opacity": .85,
				"circle-stroke-color": "#04070d",
				"circle-stroke-width": 2
			}
		});
		add({
			id: "storm-center-label",
			type: "symbol",
			source: "storm-center",
			layout: {
				"text-field": [
					"concat",
					["get", "name"],
					"  ",
					["get", "wind"]
				],
				"text-font": ["Noto Sans Bold"],
				"text-size": 11,
				"text-offset": [0, 1.6]
			},
			paint: {
				"text-color": token("--color-storm", "#ef4444"),
				"text-halo-color": "#04070d",
				"text-halo-width": 1.6
			}
		});
		for (const id of [
			"asset-point",
			"asset-halo",
			"pipeline-line"
		]) if (map.getLayer(id) && !map[`__bound_${id}`]) {
			map[`__bound_${id}`] = true;
			map.on("click", id, (e) => {
				const assetId = (e.features?.[0])?.properties?.["id"];
				if (assetId) selectRef.current?.(assetId);
			});
			map.on("mouseenter", id, () => map.getCanvas().style.cursor = "pointer");
			map.on("mouseleave", id, () => {
				map.getCanvas().style.cursor = "";
				setHovered(null);
			});
			map.on("mousemove", id, (e) => {
				const assetId = (e.features?.[0])?.properties?.["id"];
				const asset = assetsRef.current.find((a) => a.id === assetId);
				if (asset) setHovered({
					asset,
					x: e.point.x,
					y: e.point.y
				});
			});
		}
	}, []);
	const [styleVersion, setStyleVersion] = useState(0);
	buildRetryRef.current = () => {
		buildLayers();
		setStyleVersion((v) => v + 1);
	};
	useEffect(() => {
		if (ready) buildLayers();
	}, [ready, buildLayers]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !ready || userMovedRef.current || event || !catalogBounds) return;
		map.fitBounds(catalogBounds, {
			padding: 56,
			animate: false
		});
	}, [
		ready,
		event,
		catalogBounds
	]);
	const lastBasemap = useRef(null);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !ready) return;
		const next = activeBasemap;
		if (lastBasemap.current === null) {
			lastBasemap.current = next;
			return;
		}
		if (lastBasemap.current === next) return;
		lastBasemap.current = next;
		map.setStyle(basemapStyle(next));
		map.once("idle", () => {
			buildLayers();
			setStyleVersion((v) => v + 1);
		});
	}, [
		activeBasemap,
		ready,
		buildLayers
	]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !ready) return;
		const set = (id, data, visible) => {
			const s = map.getSource(id);
			if (s) s.setData(visible ? data : empty());
		};
		set("assets", assetPoints, !!layers["assets"]);
		set("pipelines", pipelineLines, !!layers["assets"]);
		set("catalog-items", catalogData, true);
		set("cone", trackData.cone, !!layers["track"]);
		set("forecast", trackData.forecast, !!layers["track"]);
		set("history", trackData.history, !!layers["track"] || !!layers["history"]);
		set("track-points", trackData.points, !!layers["track"]);
		set("ensemble", ensembleData, !!layers["uncertainty"]);
		set("prev-track", previousData.line, !!layers["previous"]);
		set("prev-cone", previousData.cone, !!layers["previous"]);
		set("wind", windData, !!layers["wind"]);
		set("rain", rainData, !!layers["rain"]);
		set("flood", floodData, !!layers["flood"]);
		set("storm-center", centerData, true);
		map.triggerRepaint();
	}, [
		ready,
		styleVersion,
		layers,
		assetPoints,
		pipelineLines,
		catalogData,
		trackData,
		ensembleData,
		previousData,
		windData,
		rainData,
		floodData,
		centerData
	]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !ready || !selectedId) return;
		const a = assets.find((x) => x.id === selectedId);
		if (a) map.easeTo({
			center: [a.lon, a.lat],
			zoom: Math.max(map.getZoom(), 6.5),
			duration: 700
		});
	}, [
		selectedId,
		ready,
		assets
	]);
	const resetView = () => {
		userMovedRef.current = false;
		mapRef.current?.fitBounds(defaultBoundsRef.current, {
			padding: 56,
			duration: 600
		});
	};
	return /* @__PURE__ */ jsxs("div", {
		className: cn("relative overflow-hidden bg-ocean-deep", className),
		children: [
			/* @__PURE__ */ jsx("div", {
				ref: containerRef,
				className: "ops-map h-full w-full"
			}),
			hovered && /* @__PURE__ */ jsxs("div", {
				className: "pointer-events-none absolute z-20 max-w-56 rounded-md border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur",
				style: {
					left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 400) - 230),
					top: hovered.y + 14
				},
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "font-medium",
						children: hovered.asset.name
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-0.5 text-muted-foreground",
						children: [
							hovered.asset.operator,
							" · ",
							hovered.asset.region
						]
					}),
					(() => {
						const r = risks.get(hovered.asset.id);
						if (!r) return null;
						return /* @__PURE__ */ jsxs("div", {
							className: "mt-1.5 flex items-center gap-2",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "size-2 rounded-full",
									style: { backgroundColor: riskColorVar(r.level) }
								}),
								/* @__PURE__ */ jsx("span", {
									className: "num font-semibold",
									children: r.score
								}),
								/* @__PURE__ */ jsx("span", {
									className: "text-muted-foreground capitalize",
									children: r.level
								}),
								r.hoursToImpact !== null && /* @__PURE__ */ jsxs("span", {
									className: "num text-muted-foreground",
									children: [
										"· ETA ",
										r.hoursToImpact,
										"h"
									]
								})
							]
						});
					})()
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "absolute top-3 right-3 flex flex-col items-end gap-1.5",
				children: [/* @__PURE__ */ jsx("div", {
					className: "flex overflow-hidden rounded-md border bg-popover/90 backdrop-blur",
					children: [
						["dark", "Map"],
						["bathymetry", "Ocean"],
						["satellite", "Satellite"]
					].map(([id, label]) => /* @__PURE__ */ jsx("button", {
						onClick: () => setBasemap(id),
						disabled: satellite && id !== "satellite",
						className: `px-2 py-1 text-[10px] tracking-wide uppercase transition-colors disabled:opacity-40 ${activeBasemap === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`,
						children: label
					}, id))
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex flex-col gap-1 rounded-md border bg-popover/90 p-1 backdrop-blur",
					children: [
						/* @__PURE__ */ jsx("button", {
							className: "rounded-sm p-1.5 hover:bg-accent",
							onClick: () => mapRef.current?.zoomIn(),
							"aria-label": "Zoom in",
							children: /* @__PURE__ */ jsx(Plus, { className: "size-4" })
						}),
						/* @__PURE__ */ jsx("button", {
							className: "rounded-sm p-1.5 hover:bg-accent",
							onClick: () => mapRef.current?.zoomOut(),
							"aria-label": "Zoom out",
							children: /* @__PURE__ */ jsx(Minus, { className: "size-4" })
						}),
						/* @__PURE__ */ jsx("button", {
							className: "rounded-sm p-1.5 hover:bg-accent",
							onClick: resetView,
							"aria-label": "Reset view",
							children: /* @__PURE__ */ jsx(Crosshair, { className: "size-4" })
						})
					]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "num pointer-events-none absolute bottom-3 left-3 rounded-md border bg-popover/85 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur",
				children: [cursor ? `${Math.abs(cursor.lat).toFixed(2)}°N  ${Math.abs(cursor.lon).toFixed(2)}°W` : "— °N  — °W", /* @__PURE__ */ jsxs("span", {
					className: "ml-2 opacity-70",
					children: ["z", zoomLevel.toFixed(1)]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "absolute right-3 bottom-3 flex flex-col items-end gap-1.5",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "rounded-md border bg-popover/90 px-3 py-2 text-[11px] backdrop-blur",
					children: [/* @__PURE__ */ jsx("div", {
						className: "label-xs mb-1",
						children: "Risk state"
					}), /* @__PURE__ */ jsx("div", {
						className: "flex gap-3",
						children: [
							"normal",
							"monitor",
							"elevated",
							"high",
							"critical"
						].map((l) => /* @__PURE__ */ jsxs("span", {
							className: "flex items-center gap-1 capitalize",
							children: [/* @__PURE__ */ jsx("span", {
								className: "size-2 rounded-full",
								style: { backgroundColor: riskColorVar(l) }
							}), l]
						}, l))
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "pointer-events-none text-[9.5px] text-muted-foreground/70",
					children: [
						"Basemap: ",
						basemapProviderLabel,
						" · Hazard layers: Planetary Computer Pro · Track: Aurora/ECMWF cycle"
					]
				})]
			})
		]
	});
}
//#endregion
export { GeoMap as default };
