import { fitBandLabels } from "@/features/catalog/preferences";
import type { MapMarker } from "./adapter";

export function fitAppearance(band: MapMarker["fitBand"], selected: boolean) {
  const color = selected ? "#222222" : "#e00b41";
  return {
    color,
    radius: band === "high" ? 10 : band === "reasonable" ? 7 : selected ? 6 : 5,
    fill: band === "weak" ? "#ffffff" : color,
    outline: band === "weak" ? color : "#ffffff",
    outlineWidth: band === "high" ? 3 : 2,
    label: band
      ? `\n${fitBandLabels[band]}`
      : band === null
        ? "\nتناسب نامشخص"
        : "",
  };
}
