import { lazy, useEffect } from "react";

import {
  createFakeMapAdapter,
  MapProviderError,
  type MapAdapter,
  type MapAdapterProps,
} from "./adapter";
import { configuredMapAdapterName, neshanMapKey } from "./environment";

const deterministicFakeMapAdapter = createFakeMapAdapter();
const LazyNeshanMapAdapter = lazy(async () => {
  const module = await import("./NeshanMapAdapter");
  return { default: module.NeshanMapAdapter };
});
const LazyOpenStreetMapAdapter = lazy(async () => {
  const module = await import("./OpenStreetMapAdapter");
  return { default: module.OpenStreetMapAdapter };
});

function MissingNeshanConfiguration({ onError, retryToken }: MapAdapterProps) {
  useEffect(() => {
    onError(
      new MapProviderError(
        "VITE_NESHAN_MAP_KEY is required to initialize the production map",
      ),
    );
  }, [onError, retryToken]);
  return null;
}

export const configuredMapAdapter: MapAdapter =
  configuredMapAdapterName === "fake"
    ? deterministicFakeMapAdapter
    : configuredMapAdapterName === "openstreetmap"
      ? LazyOpenStreetMapAdapter
      : neshanMapKey
        ? LazyNeshanMapAdapter
        : MissingNeshanConfiguration;
