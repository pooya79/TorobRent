import Feature from "ol/Feature.js";
import type MapBrowserEvent from "ol/MapBrowserEvent.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import CircleGeometry from "ol/geom/Circle.js";
import { defaults as defaultInteractions } from "ol/interaction/defaults.js";
import Point from "ol/geom/Point.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import "ol/ol.css";
import { fromLonLat, toLonLat } from "ol/proj.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import CircleStyle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import Style from "ol/style/Style.js";
import Text from "ol/style/Text.js";
import { useEffect, useRef, useState } from "react";

import {
  MapProviderError,
  markerLabelIsVisible,
  type MapAdapterProps,
  type MapViewport,
} from "./adapter";
import { openStreetMapTileUrl } from "./environment";
import { mapViewOptions } from "./view-constraints";

type MapFeatureMetadata =
  | { kind: "approximate-location"; propertyId: string }
  | { kind: "marker"; propertyId: string }
  | { kind: "cluster"; clusterId: string; propertyCount: number };

function featureMetadata(feature: Feature): MapFeatureMetadata | null {
  const value: unknown = feature.get("mapMetadata");
  if (typeof value !== "object" || value === null) return null;
  const metadata = value as Record<string, unknown>;
  if (
    (metadata.kind === "approximate-location" || metadata.kind === "marker") &&
    typeof metadata.propertyId === "string"
  ) {
    return { kind: metadata.kind, propertyId: metadata.propertyId };
  }
  if (
    metadata.kind === "cluster" &&
    typeof metadata.clusterId === "string" &&
    typeof metadata.propertyCount === "number"
  ) {
    return {
      kind: metadata.kind,
      clusterId: metadata.clusterId,
      propertyCount: metadata.propertyCount,
    };
  }
  return null;
}

function viewportFromMap(map: Map): MapViewport | null {
  const size = map.getSize();
  if (!size) return null;
  const [minimumX, minimumY, maximumX, maximumY] = map
    .getView()
    .calculateExtent(size);
  if (
    minimumX === undefined ||
    minimumY === undefined ||
    maximumX === undefined ||
    maximumY === undefined
  ) {
    return null;
  }
  const [west, south] = toLonLat([minimumX, minimumY]);
  const [east, north] = toLonLat([maximumX, maximumY]);
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined
  ) {
    return null;
  }
  return {
    north,
    east,
    south,
    west,
    zoom: map.getView().getZoom() ?? 0,
  };
}

function markerStyle(selected: boolean, label: string, showLabel: boolean) {
  return new Style({
    image: new CircleStyle({
      radius: selected ? 10 : 8,
      fill: new Fill({ color: selected ? "#222222" : "#e00b41" }),
      stroke: new Stroke({ color: "#ffffff", width: 3 }),
    }),
    text: showLabel
      ? new Text({
          text: label,
          offsetY: -38,
          textAlign: "center",
          font: "600 12px system-ui",
          fill: new Fill({ color: "#18181b" }),
          backgroundFill: new Fill({ color: "rgba(255, 255, 255, 0.96)" }),
          backgroundStroke: new Stroke({ color: "#e4e4e7", width: 1 }),
          padding: [5, 7, 5, 7],
        })
      : undefined,
  });
}

function clusterStyle(propertyCount: number) {
  return new Style({
    image: new CircleStyle({
      radius: 18,
      fill: new Fill({ color: "#e00b41" }),
      stroke: new Stroke({ color: "#ffffff", width: 3 }),
    }),
    text: new Text({
      text: new Intl.NumberFormat("fa-IR").format(propertyCount),
      fill: new Fill({ color: "#ffffff" }),
      font: "600 13px system-ui",
    }),
  });
}

export function OpenStreetMapAdapter({
  initialViewport,
  viewConstraints,
  markers,
  clusters,
  selectedPropertyId,
  retryToken,
  onReady,
  onError,
  onViewportChange,
  onSelectProperty,
  onPreviewProperty,
  onSelectCluster,
}: MapAdapterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialViewportRef = useRef(initialViewport);
  const userMovementRef = useRef(false);
  const [map, setMap] = useState<Map | null>(null);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const tileSource = new OSM({
      url: openStreetMapTileUrl,
      crossOrigin: "anonymous",
    });
    const handleProviderError = () =>
      onError(new MapProviderError("OpenStreetMap tile request failed"));
    tileSource.on("tileloaderror", handleProviderError);

    try {
      const initializedMap = new Map({
        target,
        keyboardEventTarget: target,
        controls: defaultControls({ attribution: false }),
        interactions: defaultInteractions({ onFocusOnly: false }),
        layers: [new TileLayer({ source: tileSource })],
        view: new View(
          mapViewOptions(
            initialViewportRef.current,
            viewConstraints,
            fromLonLat,
          ),
        ),
      });
      setMap(initializedMap);
      onReady();
      return () => {
        tileSource.un("tileloaderror", handleProviderError);
        setMap(null);
        initializedMap.setTarget(undefined);
      };
    } catch (error) {
      tileSource.un("tileloaderror", handleProviderError);
      onError(
        new MapProviderError("OpenStreetMap initialization failed", {
          cause: error,
        }),
      );
    }
  }, [onError, onReady, retryToken, viewConstraints]);

  useEffect(() => {
    if (!map) return;
    const target = map.getTargetElement();
    const markUserMovement = () => {
      userMovementRef.current = true;
    };
    const handleMoveEnd = () => {
      const viewport = viewportFromMap(map);
      const origin = userMovementRef.current ? "user" : "programmatic";
      userMovementRef.current = false;
      if (viewport) onViewportChange(viewport, origin);
    };
    target.addEventListener("pointerdown", markUserMovement);
    target.addEventListener("touchstart", markUserMovement);
    target.addEventListener("wheel", markUserMovement);
    target.addEventListener("keydown", markUserMovement);
    map.on("moveend", handleMoveEnd);
    return () => {
      target.removeEventListener("pointerdown", markUserMovement);
      target.removeEventListener("touchstart", markUserMovement);
      target.removeEventListener("wheel", markUserMovement);
      target.removeEventListener("keydown", markUserMovement);
      map.un("moveend", handleMoveEnd);
    };
  }, [map, onViewportChange]);

  useEffect(() => {
    if (!map) return;
    const source = new VectorSource();

    for (const marker of markers) {
      const center = fromLonLat([
        marker.approximateLocation.center.longitude,
        marker.approximateLocation.center.latitude,
      ]);
      source.addFeature(
        new Feature({
          geometry: new CircleGeometry(
            center,
            marker.approximateLocation.radiusMeters,
          ),
          mapMetadata: {
            kind: "approximate-location",
            propertyId: marker.propertyId,
          } satisfies MapFeatureMetadata,
        }),
      );
      source.addFeature(
        new Feature({
          geometry: new Point(center),
          mapMetadata: {
            kind: "marker",
            propertyId: marker.propertyId,
          } satisfies MapFeatureMetadata,
        }),
      );
    }
    for (const cluster of clusters) {
      source.addFeature(
        new Feature({
          geometry: new Point(
            fromLonLat([cluster.center.longitude, cluster.center.latitude]),
          ),
          mapMetadata: {
            kind: "cluster",
            clusterId: cluster.id,
            propertyCount: cluster.propertyCount,
          } satisfies MapFeatureMetadata,
        }),
      );
    }

    const layer = new VectorLayer({
      source,
      style: (feature) => {
        const metadata = featureMetadata(feature as Feature);
        if (metadata?.kind === "approximate-location") {
          return new Style({
            fill: new Fill({ color: "rgba(224, 11, 65, 0.10)" }),
            stroke: new Stroke({ color: "#e00b41", width: 1.5 }),
          });
        }
        if (metadata?.kind === "cluster") {
          return clusterStyle(metadata.propertyCount);
        }
        const propertyId =
          metadata?.kind === "marker" ? metadata.propertyId : null;
        const marker = markers.find((item) => item.propertyId === propertyId);
        const selected = propertyId === selectedPropertyId;
        return markerStyle(
          selected,
          marker?.label ?? "",
          Boolean(marker) && markerLabelIsVisible(),
        );
      },
    });
    map.addLayer(layer);

    const handleSelect = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const metadata = featureMetadata(feature as Feature);
        if (metadata?.kind === "marker") {
          userMovementRef.current = false;
          onSelectProperty(metadata.propertyId);
          onPreviewProperty(metadata.propertyId);
          return feature;
        }
        if (metadata?.kind === "cluster") {
          onSelectCluster(metadata.clusterId);
          userMovementRef.current = true;
          const cluster = clusters.find(
            (item) => item.id === metadata.clusterId,
          );
          if (cluster) {
            const southWest = fromLonLat([
              cluster.bounds.west,
              cluster.bounds.south,
            ]);
            const northEast = fromLonLat([
              cluster.bounds.east,
              cluster.bounds.north,
            ]);
            map.getView().fit([...southWest, ...northEast], {
              duration: 200,
              maxZoom: 16,
              padding: [64, 64, 64, 64],
            });
          }
          return feature;
        }
        return undefined;
      });
    };
    map.on("singleclick", handleSelect);

    return () => {
      map.un("singleclick", handleSelect);
      map.removeLayer(layer);
    };
  }, [
    clusters,
    map,
    markers,
    onPreviewProperty,
    onSelectCluster,
    onSelectProperty,
    selectedPropertyId,
  ]);

  return (
    <div className="relative h-full min-h-80 w-full">
      <div
        ref={containerRef}
        dir="rtl"
        lang="fa"
        role="application"
        aria-label="نقشه تعاملی ملک‌ها"
        tabIndex={0}
        className="h-full min-h-80 w-full"
      />
      {markers.length > 0 ? (
        <details className="bg-background/95 absolute start-2 top-2 z-10 max-h-[50%] max-w-[calc(100%-1rem)] overflow-auto rounded-lg border p-2 text-sm shadow-md">
          <summary className="focus-visible:ring-ring cursor-pointer rounded px-2 py-1 font-semibold focus-visible:ring-2 focus-visible:outline-none">
            انتخاب ملک از فهرست نقشه
          </summary>
          <div className="mt-2 grid gap-2">
            {markers.map((marker) => (
              <button
                key={marker.propertyId}
                type="button"
                className="bg-card focus-visible:ring-ring rounded-md border px-3 py-2 text-start shadow-sm focus-visible:ring-2 focus-visible:outline-none"
                aria-pressed={selectedPropertyId === marker.propertyId}
                aria-label={`انتخاب ${marker.preview.title} با صفحه‌کلید`}
                onClick={() => {
                  onSelectProperty(marker.propertyId);
                  onPreviewProperty(marker.propertyId);
                }}
              >
                <span className="block font-semibold">
                  {marker.preview.title}
                </span>
                <span className="whitespace-pre-line">{marker.label}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
      <a
        className="bg-background/90 absolute start-2 bottom-2 rounded px-2 py-1 text-xs underline underline-offset-2"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        داده‌های نقشه © OpenStreetMap
      </a>
    </div>
  );
}
