import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap adapter.
 *
 * The operational map renders on a real tiled basemap (true coastlines,
 * country/state borders, cities). The tile provider is swappable: when an
 * Azure Maps key is present we use Azure Maps render tiles, otherwise we fall
 * back to the keyless CARTO dark basemap so the console works out of the box.
 */
export type BasemapId = "dark" | "bathymetry" | "satellite";

const AZURE_KEY = import.meta.env["VITE_AZURE_MAPS_KEY"] as string | undefined;

const ATTRIB_ESRI = "Imagery &copy; Esri, Maxar, Earthstar Geographics";
const ATTRIB_ESRI_OCEAN = "Bathymetry &copy; Esri, GEBCO, NOAA, National Geographic";
const ATTRIB_AZURE = "&copy; Microsoft, &copy; TomTom";
const ATTRIB_CARTO = "&copy; OpenStreetMap contributors, &copy; CARTO";

function rasterStyle(
  layers: { tiles: string[]; opacity?: number }[],
  attribution: string,
  background: string,
): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const styleLayers: StyleSpecification["layers"] = [
    { id: "bg", type: "background", paint: { "background-color": background } },
  ];
  layers.forEach((l, i) => {
    const id = `basemap-${i}`;
    sources[id] = {
      type: "raster",
      tiles: l.tiles,
      tileSize: 256,
      maxzoom: 19,
      attribution,
    };
    styleLayers.push({
      id,
      type: "raster",
      source: id,
      paint: { "raster-opacity": l.opacity ?? 1 },
    });
  });
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources,
    layers: styleLayers,
  };
}

/**
 * A style is either a keyless vector style URL or a raster style spec.
 * MapLibre accepts both in `new Map({ style })` and `map.setStyle()`.
 */
export function basemapStyle(id: BasemapId): StyleSpecification | string {
  if (id === "satellite") {
    return rasterStyle(
      [
        {
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
        },
      ],
      ATTRIB_ESRI,
      "#0a1622",
    );
  }

  if (id === "bathymetry") {
    // depth-shaded seafloor + place/depth labels — the standard offshore backdrop
    return rasterStyle(
      [
        {
          tiles: [
            "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
          ],
        },
        {
          tiles: [
            "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
          ],
          opacity: 0.85,
        },
      ],
      ATTRIB_ESRI_OCEAN,
      "#0a1a26",
    );
  }

  if (AZURE_KEY) {
    return rasterStyle(
      [
        {
          tiles: [
            `https://atlas.microsoft.com/map/tile?api-version=2024-04-01&tilesetId=microsoft.base.darkgrey&zoom={z}&x={x}&y={y}&tileSize=256&subscription-key=${AZURE_KEY}`,
          ],
        },
      ],
      ATTRIB_AZURE,
      "#08111c",
    );
  }

  return rasterStyle(
    [
      {
        tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
      },
    ],
    ATTRIB_CARTO,
    "#08111c",
  );
}

export const basemapProviderLabel = AZURE_KEY ? "Azure Maps" : "CARTO / OpenStreetMap";
