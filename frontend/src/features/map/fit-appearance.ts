import { fitBandLabels } from "@/features/catalog/preferences";
import type { MapMarker } from "./adapter";

export function fitAppearance(band: MapMarker["fitBand"], selected: boolean) {
  const color = selected
    ? "#222222"
    : band === "high"
      ? "#9a6700"
      : band === "reasonable"
        ? "#2563eb"
        : band === "weak"
          ? "#64748b"
          : band === null
            ? "#737373"
            : "#e00b41";
  return {
    color,
    radius: band === "high" ? 14 : band === "reasonable" ? 7 : selected ? 6 : 5,
    fill: band === "weak" ? "#ffffff" : color,
    outline: band === "weak" ? color : "#ffffff",
    outlineWidth: band === "high" ? 3 : 2,
    symbol: band
      ? { high: "★★★", reasonable: "★★☆", weak: "★☆☆" }[band]
      : band === null
        ? "؟"
        : "",
    label: band
      ? `\n${fitBandLabels[band]}`
      : band === null
        ? "\nتناسب نامشخص"
        : "",
  };
}

export function clusterAppearance(count: number, highFitCount?: number) {
  const format = (value: number) =>
    new Intl.NumberFormat("fa-IR").format(value);
  return {
    radius: highFitCount ? 24 : 18,
    color: highFitCount ? "#9a6700" : "#e00b41",
    text: format(count) + (highFitCount ? `\n★ ${format(highFitCount)}` : ""),
  };
}
