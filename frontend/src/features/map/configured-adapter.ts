import { lazy, useEffect } from "react";

import {
  createFakeMapAdapter,
  MapProviderError,
  type MapAdapter,
  type MapAdapterProps,
} from "./adapter";

const deterministicFakeMapAdapter = createFakeMapAdapter();
const LazyNeshanMapAdapter = lazy(async () => {
  const module = await import("./NeshanMapAdapter");
  return { default: module.NeshanMapAdapter };
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

const adapterSetting: unknown = import.meta.env.VITE_MAP_ADAPTER;
const neshanMapKeySetting: unknown = import.meta.env.VITE_NESHAN_MAP_KEY;
const hasNeshanMapKey =
  typeof neshanMapKeySetting === "string" &&
  neshanMapKeySetting.trim().length > 0;

export const configuredMapAdapter: MapAdapter =
  adapterSetting === "fake"
    ? deterministicFakeMapAdapter
    : hasNeshanMapKey
      ? LazyNeshanMapAdapter
      : MissingNeshanConfiguration;
