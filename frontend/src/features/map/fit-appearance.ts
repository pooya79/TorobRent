import {
  fitBandLabels,
  fitBandStars,
  fitStarSymbol,
  type FitBand,
} from "@/features/catalog/preferences";
import type { MapMarker } from "./adapter";

// Shared by both map providers and the legend. Numbers keep the rating readable
// at low zoom and shapes distinguish tiers without depending on color.
export const fitMarkerDesign = {
  high: { color: "#946200", shape: "star" },
  good: { color: "#0f766e", shape: "diamond" },
  reasonable: { color: "#2563eb", shape: "circle" },
  weak: { color: "#64748b", shape: "square" },
  very_weak: { color: "#64748b", shape: "ring" },
} as const satisfies Record<FitBand, { color: string; shape: string }>;

export function fitAppearance(band: MapMarker["fitBand"], selected: boolean) {
  const design = band ? fitMarkerDesign[band] : undefined;
  const color = design?.color ?? (band === null ? "#737373" : "#e00b41");
  const hollow = band === "very_weak" || band === null;
  return {
    color,
    shape: design?.shape ?? "circle",
    radius:
      band === "high"
        ? 18
        : band === "good" || band === "weak"
          ? 15
          : band !== undefined
            ? 11
            : selected
              ? 6
              : 5,
    fill: hollow ? "#ffffff" : color,
    outline: selected ? "#222222" : hollow ? color : "#ffffff",
    outlineWidth: selected ? 4 : 2,
    textColor: hollow ? color : "#ffffff",
    number: band
      ? new Intl.NumberFormat("fa-IR").format(fitBandStars[band])
      : band === null
        ? "؟"
        : "",
    symbol: band ? fitStarSymbol(band) : band === null ? "؟" : "",
    label: band
      ? `\n${fitBandLabels[band]} (${new Intl.NumberFormat("fa-IR").format(fitBandStars[band])} از ۵ ستاره)`
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
    color: highFitCount ? fitMarkerDesign.high.color : "#e00b41",
    text: format(count) + (highFitCount ? `\n★ ${format(highFitCount)}` : ""),
  };
}
