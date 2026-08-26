const adapterSetting: unknown = import.meta.env.VITE_MAP_ADAPTER;
const neshanMapKeySetting: unknown = import.meta.env.VITE_NESHAN_MAP_KEY;

export const configuredMapAdapterName =
  adapterSetting === "fake" ? "fake" : "neshan";

export const neshanMapKey =
  typeof neshanMapKeySetting === "string" ? neshanMapKeySetting.trim() : "";
