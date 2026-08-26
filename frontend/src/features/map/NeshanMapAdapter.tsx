import Feature from "@neshan-maps-platform/ol/Feature";
import CircleGeometry from "@neshan-maps-platform/ol/geom/Circle";
import Point from "@neshan-maps-platform/ol/geom/Point";
import VectorLayer from "@neshan-maps-platform/ol/layer/Vector";
import type ProviderMap from "@neshan-maps-platform/ol/Map";
import ProviderMapConstructor from "@neshan-maps-platform/ol/Map";
import "@neshan-maps-platform/ol/ol.css";
import { fromLonLat, toLonLat } from "@neshan-maps-platform/ol/proj";
import VectorSource from "@neshan-maps-platform/ol/source/Vector";
import CircleStyle from "@neshan-maps-platform/ol/style/Circle";
import Fill from "@neshan-maps-platform/ol/style/Fill";
import Stroke from "@neshan-maps-platform/ol/style/Stroke";
import Style from "@neshan-maps-platform/ol/style/Style";
import Text from "@neshan-maps-platform/ol/style/Text";
import View from "@neshan-maps-platform/ol/View";
import { useEffect, useRef, useState } from "react";

import {
  MapProviderError,
  type MapAdapterProps,
  type MapViewport,
} from "./adapter";
import { neshanMapKey } from "./environment";

type TileErrorSource = {
  on: (type: "tileloaderror", listener: () => void) => unknown;
  un: (type: "tileloaderror", listener: () => void) => void;
};

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

function viewportFromMap(map: ProviderMap): MapViewport | null {
  const size = map.getSize();
  if (!size) return null;
  const extent = map.getView().calculateExtent(size);
  const [minimumX, minimumY, maximumX, maximumY] = extent;
  if (
    minimumX === undefined ||
    minimumY === undefined ||
    maximumX === undefined ||
    maximumY === undefined
  ) {
    return null;
  }
  const southWest = toLonLat([minimumX, minimumY]);
  const northEast = toLonLat([maximumX, maximumY]);
  const [west, south] = southWest;
  const [east, north] = northEast;
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

function markerStyle(selected: boolean) {
  return new Style({
    image: new CircleStyle({
      radius: selected ? 10 : 8,
      fill: new Fill({ color: selected ? "#222222" : "#e00b41" }),
      stroke: new Stroke({ color: "#ffffff", width: 3 }),
    }),
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

export function NeshanMapAdapter({
  initialViewport,
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
  const [map, setMap] = useState<ProviderMap | null>(null);

  useEffect(() => {
    if (!neshanMapKey) {
      onError(
        new MapProviderError(
          "VITE_NESHAN_MAP_KEY is required to initialize the production map",
        ),
      );
      return;
    }
    const target = containerRef.current;
    if (!target) return;
    const center = fromLonLat([
      (initialViewport.east + initialViewport.west) / 2,
      (initialViewport.north + initialViewport.south) / 2,
    ]);
    try {
      const initializedMap = new ProviderMapConstructor({
        target,
        key: neshanMapKey,
        mapType: "neshan",
        poi: true,
        traffic: false,
        keyboardEventTarget: target,
        view: new View({ center, zoom: initialViewport.zoom }),
      });
      setMap(initializedMap);
      onReady();
      return () => {
        setMap(null);
        initializedMap.setTarget(undefined);
      };
    } catch (error) {
      onError(
        new MapProviderError("Neshan map initialization failed", {
          cause: error,
        }),
      );
    }
  }, [initialViewport, onError, onReady, retryToken]);

  useEffect(() => {
    if (!map) return;
    const handleMoveEnd = () => {
      const viewport = viewportFromMap(map);
      if (viewport) onViewportChange(viewport);
    };
    map.on("moveend", handleMoveEnd);
    return () => map.un("moveend", handleMoveEnd);
  }, [map, onViewportChange]);

  useEffect(() => {
    if (!map) return;
    const handleProviderError = () =>
      onError(new MapProviderError("Neshan tile request failed"));
    const sources = map
      .getAllLayers()
      .map((layer) => layer.getSource())
      .filter((source) => source !== null) as unknown as TileErrorSource[];
    for (const source of sources) {
      source.on("tileloaderror", handleProviderError);
    }
    return () => {
      for (const source of sources) {
        source.un("tileloaderror", handleProviderError);
      }
    };
  }, [map, onError]);

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
        return markerStyle(
          metadata?.kind === "marker" &&
            metadata.propertyId === selectedPropertyId,
        );
      },
    });
    map.addLayer(layer);

    const handleSelect = (event: { pixel: number[] }) => {
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature: Feature) => {
          const metadata = featureMetadata(feature);
          if (metadata?.kind === "marker") {
            onSelectProperty(metadata.propertyId);
            onPreviewProperty(metadata.propertyId);
            return feature;
          }
          if (metadata?.kind === "cluster") {
            onSelectCluster(metadata.clusterId);
            const geometry = feature.getGeometry();
            if (geometry instanceof Point) {
              map.getView().animate({
                center: geometry.getCoordinates(),
                zoom: (map.getView().getZoom() ?? initialViewport.zoom) + 2,
                duration: 200,
              });
            }
            return feature;
          }
          return undefined;
        },
        {},
      );
    };
    map.on("singleclick", handleSelect);

    return () => {
      map.un("singleclick", handleSelect);
      map.removeLayer(layer);
    };
  }, [
    clusters,
    initialViewport.zoom,
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
      <a
        className="bg-background/90 absolute start-2 bottom-2 rounded px-2 py-1 text-xs underline underline-offset-2"
        href="https://neshan.org"
        target="_blank"
        rel="noreferrer"
      >
        داده‌های نقشه © نشان
      </a>
    </div>
  );
}
