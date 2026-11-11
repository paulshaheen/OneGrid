import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, GeoJSONSource, ImageSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { basemapStyle } from "@/lib/map/basemap";
import { NETWORK_BBOX } from "@/lib/data/se-transmission";

if (typeof window !== "undefined") maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Corners = [[number, number], [number, number], [number, number], [number, number]];

export interface CorridorMapProps {
  lines: FeatureCollection;
  substations: FeatureCollection;
  depots: FeatureCollection;
  arrows: FeatureCollection;
  weather: { url: string; coordinates: Corners } | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

const BLANK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const BBOX_CORNERS: Corners = [
  [NETWORK_BBOX.minLon, NETWORK_BBOX.maxLat],
  [NETWORK_BBOX.maxLon, NETWORK_BBOX.maxLat],
  [NETWORK_BBOX.maxLon, NETWORK_BBOX.minLat],
  [NETWORK_BBOX.minLon, NETWORK_BBOX.minLat],
];

/** Upward arrow drawn once into an SDF icon so the layer can tint it. */
function arrowIcon(): ImageData {
  const s = 32;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(25, 14);
  ctx.lineTo(19, 14);
  ctx.lineTo(19, 30);
  ctx.lineTo(13, 30);
  ctx.lineTo(13, 14);
  ctx.lineTo(7, 14);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

export default function CorridorMap(props: CorridorMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle("dark"),
      bounds: [
        [NETWORK_BBOX.minLon, NETWORK_BBOX.minLat],
        [NETWORK_BBOX.maxLon, NETWORK_BBOX.maxLat],
      ],
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      maxZoom: 11,
      minZoom: 4,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.on("load", () => {
      const p = propsRef.current;
      map.addImage("wind-arrow", arrowIcon(), { sdf: true });
      map.addSource("wx", { type: "image", url: BLANK, coordinates: BBOX_CORNERS });
      map.addSource("arrows", { type: "geojson", data: p.arrows });
      map.addSource("lines", { type: "geojson", data: p.lines });
      map.addSource("subs", { type: "geojson", data: p.substations });
      map.addSource("depots", { type: "geojson", data: p.depots });
      map.addLayer({
        id: "wx",
        type: "raster",
        source: "wx",
        paint: { "raster-opacity": 0.85, "raster-resampling": "linear", "raster-fade-duration": 0 },
      });
      map.addLayer({
        id: "arrows",
        type: "symbol",
        source: "arrows",
        layout: {
          "icon-image": "wind-arrow",
          "icon-rotate": ["get", "rot"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-size": ["interpolate", ["linear"], ["get", "mph"], 0, 0.3, 10, 0.5, 30, 0.85],
        },
        paint: { "icon-color": "#e8f1ff", "icon-opacity": 0.55 },
      });
      map.addLayer({
        id: "lines-casing",
        type: "line",
        source: "lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#05101f", "line-width": ["+", ["get", "width"], 2.5], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "lines",
        type: "line",
        source: "lines",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] },
      });
      map.addLayer({
        id: "lines-selected",
        type: "line",
        source: "lines",
        filter: ["==", ["get", "id"], ""],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["+", ["get", "width"], 3], "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "subs",
        type: "circle",
        source: "subs",
        paint: {
          "circle-radius": ["match", ["get", "kv"], 500, 5, 230, 3.5, 3],
          "circle-color": "#0b1628",
          "circle-stroke-color": "#cfe3ff",
          "circle-stroke-width": 1.4,
        },
      });
      map.addLayer({
        id: "subs-label",
        type: "symbol",
        source: "subs",
        minzoom: 6.2,
        layout: { "text-field": ["get", "name"], "text-size": 10, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": "#9fb4d8", "text-halo-color": "#05101f", "text-halo-width": 1.2 },
      });
      map.addLayer({
        id: "depots",
        type: "circle",
        source: "depots",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "need"], 0, 6, 10, 14],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "depots-label",
        type: "symbol",
        source: "depots",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top" },
        paint: { "text-color": "#ffffff", "text-halo-color": "#05101f", "text-halo-width": 1.5 },
      });
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["lines"] })[0];
        const id = hit?.properties?.["id"];
        propsRef.current.onSelect(typeof id === "string" ? id : null);
      });
      map.on("mouseenter", "lines", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "lines", () => (map.getCanvas().style.cursor = ""));
      readyRef.current = true;
      sync(map, propsRef.current);
    });
    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) sync(map, props);
  }, [props.lines, props.substations, props.depots, props.arrows, props.weather, props.selectedId]);

  // MapLibre sets `position: relative` on its container, so positioning lives on a wrapper.
  return (
    <div className={props.className}>
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}

function sync(map: MlMap, p: CorridorMapProps) {
  (map.getSource("lines") as GeoJSONSource | undefined)?.setData(p.lines);
  (map.getSource("subs") as GeoJSONSource | undefined)?.setData(p.substations);
  (map.getSource("depots") as GeoJSONSource | undefined)?.setData(p.depots);
  (map.getSource("arrows") as GeoJSONSource | undefined)?.setData(p.arrows);
  (map.getSource("wx") as ImageSource | undefined)?.updateImage(
    p.weather ? { url: p.weather.url, coordinates: p.weather.coordinates } : { url: BLANK, coordinates: BBOX_CORNERS },
  );
  if (map.getLayer("lines-selected")) map.setFilter("lines-selected", ["==", ["get", "id"], p.selectedId ?? ""]);
}
