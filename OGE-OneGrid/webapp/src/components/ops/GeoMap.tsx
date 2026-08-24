import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { Crosshair, Minus, Plus } from "lucide-react";
import type { Feature, FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 derives its worker URL at runtime via `new URL(`./${name}`,
// import.meta.url)`. That expression is not statically analysable, so the
// production (Rolldown) bundle never emits `maplibre-gl-worker.mjs` — the
// browser requests `/assets/maplibre-gl-worker.mjs`, the server 404s/redirects,
// the worker boots empty, and every GeoJSON source silently stalls (raster
// tiles still render because they decode on the main thread). Importing the
// worker through Vite's `?worker&url` transform emits it as a real, hashed
// worker chunk (with its `maplibre-gl-shared.mjs` dependency bundled in) and
// hands us a stable URL that works in both dev and the production build.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

if (typeof Worker !== "undefined") {
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
}

import type {
  Asset,
  AssetRisk,
  GeospatialLayer,
  RiskLevel,
  WeatherEvent,
} from "@/lib/domain/types";
import { basemapProviderLabel, basemapStyle, type BasemapId } from "@/lib/map/basemap";
import { circlePolygon, conePolygon, empty, feature, quadrantPolygon } from "@/lib/map/geojson";
import { riskColorVar } from "@/lib/format";
import { cn } from "@/lib/utils";

export type LayerState = Record<string, boolean>;

export interface OpsMapProps {
  assets: Asset[];
  risks: Map<string, AssetRisk>;
  event?: WeatherEvent | null | undefined;
  layers: LayerState;
  catalogLayers?: GeospatialLayer[] | undefined;
  selectedId?: string | null | undefined;
  highlightIds?: string[] | undefined;
  hour?: number | undefined;
  onSelect?: ((id: string) => void) | undefined;
  className?: string | undefined;
}

const GULF_BOUNDS: [[number, number], [number, number]] = [
  [-98.5, 17.5],
  [-79.5, 31.5],
];

/**
 * Resolve a design token to an rgb() string. MapLibre's style parser predates
 * oklch(), so oklch tokens are converted to sRGB before they reach a layer.
 */
const colorCache = new Map<string, string>();

function oklchToRgb(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;

  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const srgb = lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(255, Math.max(0, g * 255)));
  });
  return `rgb(${srgb[0]}, ${srgb[1]}, ${srgb[2]})`;
}

function toRgb(value: string, fallback: string): string {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (m) {
    const l = parseFloat(m[1]!) / (m[2] ? 100 : 1);
    return oklchToRgb(l, parseFloat(m[3]!), parseFloat(m[4]!));
  }
  return /^(#|rgb|hsl)/i.test(value) ? value : fallback;
}

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const cached = colorCache.get(name);
  if (cached) return cached;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const resolved = raw ? toRgb(raw, fallback) : fallback;
  colorCache.set(name, resolved);
  return resolved;
}

function riskColor(level: RiskLevel | undefined): string {
  const varName = riskColorVar(level ?? "normal").replace(/^var\(|\)$/g, "");
  return token(varName, "rgb(100, 116, 139)");
}

function categoryColor(category: number, windMph: number): string {
  if (category >= 5) return token("--color-cat5", "#f0abfc");
  if (category >= 4) return token("--color-cat4", "#f87171");
  if (category >= 3) return token("--color-cat3", "#fb923c");
  if (category >= 2) return token("--color-cat2", "#fbbf24");
  if (category >= 1) return token("--color-cat1", "#facc15");
  if (windMph >= 39) return token("--color-cat-ts", "#4ade80");
  return token("--color-cat-td", "#38bdf8");
}

function categoryLabel(category: number, windMph: number): string {
  if (category >= 1) return `C${category}`;
  return windMph >= 39 ? "TS" : "TD";
}

function interpolatePosition(event: WeatherEvent | null | undefined, hour: number) {
  if (!event || event.forecast.length === 0) return null;
  const f = event.forecast;
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i]!;
    const b = f[i + 1]!;
    if (hour >= a.hour && hour <= b.hour) {
      const t = (hour - a.hour) / (b.hour - a.hour);
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        windMph: Math.round(a.windMph + (b.windMph - a.windMph) * t),
        coneRadiusMi: a.coneRadiusMi + (b.coneRadiusMi - a.coneRadiusMi) * t,
        category: t < 0.5 ? a.category : b.category,
      };
    }
  }
  const last = f[f.length - 1]!;
  return { ...last };
}

const RISK_RANK: Record<string, number> = {
  normal: 0,
  monitor: 1,
  elevated: 2,
  high: 3,
  critical: 4,
};

const MAJOR_TYPES = new Set(["refinery", "lng_terminal", "port", "storage", "offshore_platform"]);

export default function GeoMap({
  assets,
  risks,
  event,
  layers,
  catalogLayers = [],
  selectedId,
  highlightIds = [],
  hour = 0,
  onSelect,
  className,
}: OpsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);
  const [hovered, setHovered] = useState<{ asset: Asset; x: number; y: number } | null>(null);

  const satellite = !!layers["satellite"];
  const [basemap, setBasemap] = useState<BasemapId>("dark");
  // the satellite layer toggle always wins over the manual basemap picker
  const activeBasemap: BasemapId = satellite ? "satellite" : basemap;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const pos = useMemo(() => interpolatePosition(event, hour), [event, hour]);

  const catalogData: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: catalogLayers.flatMap((layer) =>
        layers[layer.id]
          ? (layer.data?.features ?? []).map((item) => ({
              ...item,
              properties: {
                ...item.properties,
                catalogCollection: layer.name,
              },
            }))
          : [],
      ) as Feature[],
    }),
    [catalogLayers, layers],
  );
  const catalogBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    const boxes = catalogData.features
      .map((item) => item.bbox)
      .filter((bbox): bbox is number[] => !!bbox && bbox.length >= 4);
    if (boxes.length === 0) return null;
    return [
      [Math.min(...boxes.map((bbox) => bbox[0]!)), Math.min(...boxes.map((bbox) => bbox[1]!))],
      [Math.max(...boxes.map((bbox) => bbox[2]!)), Math.max(...boxes.map((bbox) => bbox[3]!))],
    ];
  }, [catalogData]);
  const defaultBoundsRef = useRef(GULF_BOUNDS);
  defaultBoundsRef.current = !event && catalogBounds ? catalogBounds : GULF_BOUNDS;

  // ---------------------------------------------------------------- sources
  const assetPoints: FeatureCollection = useMemo(() => {
    const feats = assets
      .filter((a) => a.type !== "pipeline")
      .slice()
      .sort(
        (a, b) =>
          (RISK_RANK[risks.get(a.id)?.level ?? "normal"] ?? 0) -
          (RISK_RANK[risks.get(b.id)?.level ?? "normal"] ?? 0),
      )
      .map((a) => {
        const r = risks.get(a.id);
        return feature(
          { type: "Point", coordinates: [a.lon, a.lat] },
          {
            id: a.id,
            name: a.name,
            type: a.type,
            major: MAJOR_TYPES.has(a.type) ? 1 : 0,
            color: riskColor(r?.level),
            score: r?.score ?? 0,
            rank: RISK_RANK[r?.level ?? "normal"] ?? 0,
            selected: selectedId === a.id ? 1 : 0,
            highlighted: highlightIds.includes(a.id) ? 1 : 0,
          },
        );
      });
    return { type: "FeatureCollection", features: feats as Feature[] };
  }, [assets, risks, selectedId, highlightIds]);

  const pipelineLines: FeatureCollection = useMemo(() => {
    const feats = assets
      .filter((a) => a.type === "pipeline" && a.geometry)
      .map((a) =>
        feature(
          { type: "LineString", coordinates: a.geometry as number[][] },
          {
            id: a.id,
            name: a.name,
            color: riskColor(risks.get(a.id)?.level),
            selected: selectedId === a.id ? 1 : 0,
          },
        ),
      );
    return { type: "FeatureCollection", features: feats as Feature[] };
  }, [assets, risks, selectedId]);

  const trackData = useMemo(() => {
    if (!event) {
      return { forecast: empty(), history: empty(), cone: empty(), points: empty() };
    }
    // A LineString needs >= 2 positions; fewer produces invalid GeoJSON that
    // stalls MapLibre's worker and blanks every vector layer. Emit empty instead.
    // Split the centerline into per-segment features coloured by intensity so
    // the track reads Cat-3 orange -> TS green as the storm evolves.
    const fpts = event.forecast;
    const forecastFeatures: Feature[] = [];
    for (let i = 0; i < fpts.length - 1; i++) {
      const a = fpts[i]!;
      const b = fpts[i + 1]!;
      forecastFeatures.push(
        feature(
          { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
          {
            color: categoryColor(Math.max(a.category, b.category), Math.max(a.windMph, b.windMph)),
          },
        ) as Feature,
      );
    }
    const historyCoords = (event.history ?? []).filter(
      (c) => Array.isArray(c) && c.length === 2,
    );
    const historyFeatures: Feature[] =
      historyCoords.length >= 2
        ? [feature({ type: "LineString", coordinates: historyCoords }) as Feature]
        : [];
    const coneFeatures: Feature[] =
      event.forecast.length >= 2
        ? [
            feature(
              conePolygon(
                event.forecast.map((p) => ({ lon: p.lon, lat: p.lat, radiusMi: p.coneRadiusMi })),
              ),
            ) as Feature,
          ]
        : [];
    const points = event.forecast.map((p) =>
      feature(
        { type: "Point", coordinates: [p.lon, p.lat] },
        {
          color: categoryColor(p.category, p.windMph),
          label: categoryLabel(p.category, p.windMph),
          detail: `+${p.hour}h · ${p.windMph} mph`,
        },
      ),
    );
    return {
      forecast: { type: "FeatureCollection", features: forecastFeatures } as FeatureCollection,
      history: { type: "FeatureCollection", features: historyFeatures } as FeatureCollection,
      cone: { type: "FeatureCollection", features: coneFeatures } as FeatureCollection,
      points: { type: "FeatureCollection", features: points as Feature[] } as FeatureCollection,
    };
  }, [event]);

  /** Cone swept only up to the animation playhead, so it grows as the eye moves. */
  const activeCone: FeatureCollection = useMemo(() => {
    if (!event || event.forecast.length < 2 || hour <= event.forecast[0]!.hour) return empty();
    const pts = event.forecast
      .filter((p) => p.hour <= hour)
      .map((p) => ({ lon: p.lon, lat: p.lat, radiusMi: p.coneRadiusMi }));
    const head = interpolatePosition(event, hour);
    if (head) pts.push({ lon: head.lon, lat: head.lat, radiusMi: head.coneRadiusMi });
    if (pts.length < 2) return empty();
    return { type: "FeatureCollection", features: [feature(conePolygon(pts)) as Feature] };
  }, [event, hour]);

  /** Ensemble spread: each member's centerline, conveying track uncertainty. */
  const ensembleData: FeatureCollection = useMemo(() => {
    if (!event) return empty();
    const members = event.ensemble ?? [];
    return {
      type: "FeatureCollection",
      features: members.map(
        (m) => feature({ type: "LineString", coordinates: m.track }, { id: m.id }) as Feature,
      ),
    };
  }, [event]);

  /** Previous forecast cycle, for cycle-over-cycle comparison. */
  const previousData = useMemo(() => {
    if (!event) return { line: empty(), cone: empty() };
    const prev = event.previousForecast ?? [];
    if (prev.length < 2) return { line: empty(), cone: empty() };
    return {
      line: {
        type: "FeatureCollection",
        features: [feature({ type: "LineString", coordinates: prev.map((p) => [p.lon, p.lat]) })],
      } as FeatureCollection,
      cone: {
        type: "FeatureCollection",
        features: [
          feature(
            conePolygon(prev.map((p) => ({ lon: p.lon, lat: p.lat, radiusMi: p.coneRadiusMi }))),
          ),
        ],
      } as FeatureCollection,
    };
  }, [event]);

  const windData: FeatureCollection = useMemo(() => {
    if (!pos) return empty();
    const scale = pos.windMph / 130;
    const rings = [
      { kt: 64, quad: [68, 58, 40, 48], color: token("--color-cat5", "#f0abfc"), opacity: 0.2 },
      { kt: 50, quad: [125, 105, 78, 92], color: token("--color-cat3", "#fb923c"), opacity: 0.14 },
      { kt: 34, quad: [205, 180, 140, 155], color: token("--color-cat1", "#facc15"), opacity: 0.1 },
    ];
    const feats = rings
      .map((r) =>
        feature(
          quadrantPolygon(
            pos.lon,
            pos.lat,
            r.quad.map((m) => m * scale),
          ),
          { kt: r.kt, color: r.color, opacity: r.opacity },
        ),
      )
      .reverse();
    return { type: "FeatureCollection", features: feats as Feature[] };
  }, [pos]);

  const rainData: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: (event?.forecast ?? []).map(
        (p) => feature(circlePolygon(p.lon, p.lat, 170, 40), { hour: p.hour }) as Feature,
      ),
    }),
    [event],
  );

  const centerData: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features:
        pos && event
          ? [
              feature(
                { type: "Point", coordinates: [pos.lon, pos.lat] },
                {
                  name: event.name,
                  wind: `${pos.windMph} mph`,
                },
              ) as Feature,
            ]
          : [],
    }),
    [pos, event],
  );

  const floodData: FeatureCollection = useMemo(() => {
    const feats = assets
      .filter((a) => MAJOR_TYPES.has(a.type) && a.type !== "offshore_platform")
      .map((a) => feature(circlePolygon(a.lon, a.lat, 22, 32)) as Feature);
    return { type: "FeatureCollection", features: feats };
  }, [assets]);

  // ------------------------------------------------------------- map set-up
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
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.getCanvasContainer().style.height = "100%";
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    setZoomLevel(map.getZoom());
    map.on("move", () => setZoomLevel(map.getZoom()));
    map.on("mousemove", (e: maplibregl.MapMouseEvent) =>
      setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat }),
    );
    map.on("mouseout", () => setCursor(null));
    map.on("load", () => {
      setReady(true);
      // the container may have been zero-sized or mid-layout at construction,
      // which leaves the initial fit pointing somewhere other than the Gulf.
      map.resize();
      if (!userMovedRef.current)
        map.fitBounds(defaultBoundsRef.current, { padding: 56, animate: false });
    });

    // any user-initiated pan/zoom stops the automatic refit
    const markMoved = () => (userMovedRef.current = true);
    map.on("dragstart", markMoved);
    map.on("wheel", markMoved);
    map.on("boxzoomstart", markMoved);

    // keep the Gulf framed when the panel resizes (breakpoint change, sidebar
    // open/close, window resize) until the operator takes control of the view.
    const ro = new ResizeObserver(() => {
      if (!mapRef.current) return;
      map.resize();
      if (!userMovedRef.current)
        map.fitBounds(defaultBoundsRef.current, { padding: 56, animate: false });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** (Re)build every operational layer — also runs after a basemap style swap. */
  const buildRetryRef = useRef<(() => void) | null>(null);
  const buildLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      // style still parsing (slow tiles/glyphs): rebuild as soon as it settles,
      // otherwise the operational layers are silently dropped.
      map.once("idle", () => buildRetryRef.current?.());
      return;
    }

    const src = (id: string, data: FeatureCollection) => {
      const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) existing.setData(data);
      else map.addSource(id, { type: "geojson", data });
    };

    src("rain", empty());
    src("flood", empty());
    src("prev-cone", empty());
    src("ensemble", empty());
    src("prev-track", empty());
    src("cone", empty());
    src("cone-active", empty());
    src("wind", empty());
    src("history", empty());
    src("forecast", empty());
    src("track-points", empty());
    src("pipelines", empty());
    src("assets", empty());
    src("catalog-items", empty());
    src("storm-center", empty());

    const add = (layer: maplibregl.LayerSpecification) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };

    add({
      id: "rain-fill",
      type: "fill",
      source: "rain",
      paint: { "fill-color": token("--color-rain", "#38bdf8"), "fill-opacity": 0.07 },
    });
    add({
      id: "flood-fill",
      type: "fill",
      source: "flood",
      paint: { "fill-color": token("--color-flood", "#22d3ee"), "fill-opacity": 0.18 },
    });
    add({
      id: "prev-cone-line",
      type: "line",
      source: "prev-cone",
      paint: {
        "line-color": token("--color-muted-foreground", "#94a3b8"),
        "line-opacity": 0.35,
        "line-width": 1,
        "line-dasharray": [2, 3],
      },
    });
    add({
      id: "ensemble-line",
      type: "line",
      source: "ensemble",
      paint: {
        "line-color": token("--color-cone", "#93c5fd"),
        "line-opacity": 0.32,
        "line-width": 0.9,
      },
    });
    add({
      id: "prev-track-line",
      type: "line",
      source: "prev-track",
      paint: {
        "line-color": token("--color-muted-foreground", "#94a3b8"),
        "line-opacity": 0.75,
        "line-width": 1.6,
        "line-dasharray": [1, 2],
      },
    });
    add({
      id: "wind-fill",
      type: "fill",
      source: "wind",
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] },
    });
    add({
      id: "wind-line",
      type: "line",
      source: "wind",
      paint: { "line-color": ["get", "color"], "line-opacity": 0.55, "line-width": 1 },
    });
    add({
      id: "cone-fill",
      type: "fill",
      source: "cone",
      paint: { "fill-color": token("--color-cone", "#93c5fd"), "fill-opacity": 0.1 },
    });
    add({
      id: "cone-line",
      type: "line",
      source: "cone",
      paint: {
        "line-color": token("--color-cone", "#93c5fd"),
        "line-opacity": 0.4,
        "line-width": 1.6,
        "line-blur": 3,
        "line-dasharray": [4, 3],
      },
    });
    add({
      id: "cone-active-fill",
      type: "fill",
      source: "cone-active",
      paint: { "fill-color": token("--color-cone", "#93c5fd"), "fill-opacity": 0.22 },
    });
    add({
      id: "cone-active-line",
      type: "line",
      source: "cone-active",
      paint: {
        "line-color": token("--color-cone", "#93c5fd"),
        "line-opacity": 0.7,
        "line-width": 2,
        "line-blur": 2.5,
      },
    });
    add({
      id: "history-line",
      type: "line",
      source: "history",
      paint: { "line-color": token("--color-muted-foreground", "#94a3b8"), "line-width": 2 },
    });
    add({
      id: "forecast-line",
      type: "line",
      source: "forecast",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
        "line-dasharray": [3, 2],
      },
    });
    add({
      id: "catalog-item-fill",
      type: "fill",
      source: "catalog-items",
      paint: {
        "fill-color": token("--color-primary", "#22d3ee"),
        "fill-opacity": 0.2,
      },
    });
    add({
      id: "catalog-item-line",
      type: "line",
      source: "catalog-items",
      paint: {
        "line-color": token("--color-primary", "#22d3ee"),
        "line-opacity": 0.95,
        "line-width": 2,
      },
    });
    add({
      id: "pipeline-casing",
      type: "line",
      source: "pipelines",
      paint: { "line-color": "#000000", "line-opacity": 0.55, "line-width": 5 },
    });
    add({
      id: "pipeline-line",
      type: "line",
      source: "pipelines",
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["==", ["get", "selected"], 1], 4, 2.2],
      },
    });
    add({
      id: "asset-halo",
      type: "circle",
      source: "assets",
      filter: [
        "any",
        ["==", ["get", "selected"], 1],
        ["==", ["get", "highlighted"], 1],
        [">=", ["get", "rank"], 4],
      ],
      paint: {
        "circle-radius": 13,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.16,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": 0.8,
      },
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
          ["case", ["==", ["get", "major"], 1], 4.5, 2.2],
          9,
          ["case", ["==", ["get", "major"], 1], 8, 4.5],
        ],
        "circle-color": ["get", "color"],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#04070d",
        "circle-stroke-width": 1,
      },
    });
    add({
      id: "asset-label",
      type: "symbol",
      source: "assets",
      filter: ["any", ["==", ["get", "major"], 1], ["==", ["get", "selected"], 1]],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 10,
        "text-offset": [0.8, 0],
        "text-anchor": "left",
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": token("--color-foreground", "#e2e8f0"),
        "text-halo-color": "#04070d",
        "text-halo-width": 1.4,
      },
    });
    add({
      id: "track-point",
      type: "circle",
      source: "track-points",
      paint: {
        "circle-radius": 7,
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#04070d",
        "circle-stroke-width": 1.2,
      },
    });
    add({
      id: "track-point-label",
      type: "symbol",
      source: "track-points",
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 9,
      },
      paint: { "text-color": "#04070d" },
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
        "text-offset": [0, -1.5],
      },
      paint: {
        "text-color": token("--color-muted-foreground", "#94a3b8"),
        "text-halo-color": "#04070d",
        "text-halo-width": 1.4,
      },
    });
    add({
      id: "storm-center",
      type: "circle",
      source: "storm-center",
      paint: {
        "circle-radius": 9,
        "circle-color": token("--color-storm", "#ef4444"),
        "circle-opacity": 0.85,
        "circle-stroke-color": "#04070d",
        "circle-stroke-width": 2,
      },
    });
    add({
      id: "storm-center-label",
      type: "symbol",
      source: "storm-center",
      layout: {
        "text-field": ["concat", ["get", "name"], "  ", ["get", "wind"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, 1.6],
      },
      paint: {
        "text-color": token("--color-storm", "#ef4444"),
        "text-halo-color": "#04070d",
        "text-halo-width": 1.6,
      },
    });

    // interactivity
    for (const id of ["asset-point", "asset-halo", "pipeline-line"]) {
      if (map.getLayer(id) && !(map as unknown as Record<string, unknown>)[`__bound_${id}`]) {
        (map as unknown as Record<string, unknown>)[`__bound_${id}`] = true;
        map.on("click", id, (e) => {
          const f = e.features?.[0];
          const assetId = f?.properties?.["id"] as string | undefined;
          if (assetId) selectRef.current?.(assetId);
        });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => {
          map.getCanvas().style.cursor = "";
          setHovered(null);
        });
        map.on("mousemove", id, (e) => {
          const f = e.features?.[0];
          const assetId = f?.properties?.["id"] as string | undefined;
          const asset = assetsRef.current.find((a) => a.id === assetId);
          if (asset) setHovered({ asset, x: e.point.x, y: e.point.y });
        });
      }
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
    map.fitBounds(catalogBounds, { padding: 56, animate: false });
  }, [ready, event, catalogBounds]);

  // basemap swap re-adds the operational layers on top of the new style
  const lastBasemap = useRef<string | null>(null);
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
    // vector styles finish asynchronously; rebuild once the new style is idle
    map.once("idle", () => {
      buildLayers();
      setStyleVersion((v) => v + 1);
    });
  }, [activeBasemap, ready, buildLayers]);

  // ------------------------------------------------------------ data sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: FeatureCollection, visible: boolean) => {
      const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (s) s.setData(visible ? data : empty());
    };
    set("assets", assetPoints, !!layers["assets"]);
    set("pipelines", pipelineLines, !!layers["assets"]);
    set("catalog-items", catalogData, true);
    set("cone", trackData.cone, !!layers["track"]);
    set("cone-active", activeCone, !!layers["track"]);
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
    activeCone,
    ensembleData,
    previousData,
    windData,
    rainData,
    floodData,
    centerData,
  ]);

  // fly to selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const a = assets.find((x) => x.id === selectedId);
    if (a)
      map.easeTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 6.5), duration: 700 });
  }, [selectedId, ready, assets]);

  const resetView = () => {
    userMovedRef.current = false;
    mapRef.current?.fitBounds(defaultBoundsRef.current, { padding: 56, duration: 600 });
  };

  return (
    <div className={cn("relative overflow-hidden bg-ocean-deep", className)}>
      <div ref={containerRef} className="ops-map h-full w-full" />

      {hovered && (
        <div
          className="pointer-events-none absolute z-20 max-w-56 rounded-md border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: Math.min(hovered.x + 14, (containerRef.current?.clientWidth ?? 400) - 230),
            top: hovered.y + 14,
          }}
        >
          <div className="font-medium">{hovered.asset.name}</div>
          <div className="mt-0.5 text-muted-foreground">
            {hovered.asset.operator} · {hovered.asset.region}
          </div>
          {(() => {
            const r = risks.get(hovered.asset.id);
            if (!r) return null;
            return (
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: riskColorVar(r.level) }}
                />
                <span className="num font-semibold">{r.score}</span>
                <span className="text-muted-foreground capitalize">{r.level}</span>
                {r.hoursToImpact !== null && (
                  <span className="num text-muted-foreground">· ETA {r.hoursToImpact}h</span>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
        <div className="flex overflow-hidden rounded-md border bg-popover/90 backdrop-blur">
          {(
            [
              ["dark", "Map"],
              ["bathymetry", "Ocean"],
              ["satellite", "Satellite"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setBasemap(id)}
              disabled={satellite && id !== "satellite"}
              className={`px-2 py-1 text-[10px] tracking-wide uppercase transition-colors disabled:opacity-40 ${
                activeBasemap === id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1 rounded-md border bg-popover/90 p-1 backdrop-blur">
          <button
            className="rounded-sm p-1.5 hover:bg-accent"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Zoom in"
          >
            <Plus className="size-4" />
          </button>
          <button
            className="rounded-sm p-1.5 hover:bg-accent"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Zoom out"
          >
            <Minus className="size-4" />
          </button>
          <button
            className="rounded-sm p-1.5 hover:bg-accent"
            onClick={resetView}
            aria-label="Reset view"
          >
            <Crosshair className="size-4" />
          </button>
        </div>
      </div>

      <div className="num pointer-events-none absolute bottom-3 left-3 rounded-md border bg-popover/85 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        {cursor
          ? `${Math.abs(cursor.lat).toFixed(2)}°N  ${Math.abs(cursor.lon).toFixed(2)}°W`
          : "— °N  — °W"}
        <span className="ml-2 opacity-70">z{zoomLevel.toFixed(1)}</span>
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col items-end gap-1.5">
        <div className="rounded-md border bg-popover/90 px-3 py-2 text-[11px] backdrop-blur">
          <div className="label-xs mb-1">Risk state</div>
          <div className="flex gap-3">
            {(["normal", "monitor", "elevated", "high", "critical"] as const).map((l) => (
              <span key={l} className="flex items-center gap-1 capitalize">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: riskColorVar(l) }}
                />
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="pointer-events-none text-[9.5px] text-muted-foreground/70">
          Basemap: {basemapProviderLabel} · Hazard layers: Planetary Computer Pro · Track:{" "}
          {event?.modelSource ?? "Aurora forecast cycle"}
        </div>
      </div>
    </div>
  );
}
