import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { basemapStyle } from "@/lib/map/basemap";

if (typeof window !== "undefined") maplibregl.setWorkerUrl(maplibreWorkerUrl);

export interface OffshoreMapProps {
  /** Points with id, label, color and kind properties. */
  sites: FeatureCollection;
  /** Front lines with color and dashed properties. */
  fronts: FeatureCollection;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

const GULF: [[number, number], [number, number]] = [
  [-94.2, 25.6],
  [-87.8, 30],
];

export default function OffshoreMap(props: OffshoreMapProps) {
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
      bounds: GULF,
      fitBoundsOptions: { padding: 20 },
      attributionControl: false,
      dragRotate: false,
      maxZoom: 10,
      minZoom: 4,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    map.on("load", () => {
      const p = propsRef.current;
      map.addSource("fronts", { type: "geojson", data: p.fronts });
      map.addSource("sites", { type: "geojson", data: p.sites });
      map.addLayer({
        id: "fronts",
        type: "line",
        source: "fronts",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.5,
          "line-opacity": 0.9,
          "line-dasharray": [3, 2],
        },
      });
      map.addLayer({
        id: "fronts-label",
        type: "symbol",
        source: "fronts",
        layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-size": 10.5, "text-offset": [0, -0.9] },
        paint: { "text-color": ["get", "color"], "text-halo-color": "#05101f", "text-halo-width": 1.4 },
      });
      map.addLayer({
        id: "sites-selected",
        type: "circle",
        source: "sites",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 14, "circle-color": "#ffffff", "circle-opacity": 0.18, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
      });
      map.addLayer({
        id: "sites",
        type: "circle",
        source: "sites",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "base", 5, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#05101f",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "sites-label",
        type: "symbol",
        source: "sites",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": "#e8f1ff", "text-halo-color": "#05101f", "text-halo-width": 1.5 },
      });
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["sites"] })[0];
        const id = hit?.properties?.["id"];
        propsRef.current.onSelect(typeof id === "string" ? id : null);
      });
      map.on("mouseenter", "sites", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "sites", () => (map.getCanvas().style.cursor = ""));
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
  }, [props.sites, props.fronts, props.selectedId]);

  // MapLibre sets `position: relative` on its container, so positioning lives on a wrapper.
  return (
    <div className={props.className}>
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}

function sync(map: MlMap, p: OffshoreMapProps) {
  (map.getSource("sites") as GeoJSONSource | undefined)?.setData(p.sites);
  (map.getSource("fronts") as GeoJSONSource | undefined)?.setData(p.fronts);
  if (map.getLayer("sites-selected")) map.setFilter("sites-selected", ["==", ["get", "id"], p.selectedId ?? ""]);
}
