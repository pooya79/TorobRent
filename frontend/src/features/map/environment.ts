const adapterSetting: unknown = import.meta.env.VITE_MAP_ADAPTER;
const neshanMapKeySetting: unknown = import.meta.env.VITE_NESHAN_MAP_KEY;
const openStreetMapTileUrlSetting: unknown = import.meta.env
  .VITE_OPENSTREETMAP_TILE_URL;

export const configuredMapAdapterName =
  adapterSetting === "fake" || adapterSetting === "openstreetmap"
    ? adapterSetting
    : "neshan";

export const neshanMapKey =
  typeof neshanMapKeySetting === "string" ? neshanMapKeySetting.trim() : "";

export const openStreetMapTileUrl =
  typeof openStreetMapTileUrlSetting === "string" &&
  openStreetMapTileUrlSetting.trim()
    ? openStreetMapTileUrlSetting.trim()
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
