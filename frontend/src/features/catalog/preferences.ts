import type { components } from "@/lib/api/schema";

export type PreferenceAssessment =
  components["schemas"]["PreferenceAssessment"];
export const preferenceLabels = {
  property_type: "نوع ملک",
  district: "منطقه",
  neighborhood: "محله",
  area: "متراژ",
  bedroom_count: "تعداد اتاق خواب",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
  monthly_rent: "اجاره ماهانه کمتر",
  deposit: "رهن کمتر",
  construction_year: "سال ساخت",
  freshness: "تازگی تایید موجود بودن",
} as const;
export type PreferenceId = keyof typeof preferenceLabels;
export const fitBandLabels = {
  high: "تناسب زیاد",
  reasonable: "تناسب قابل قبول",
  weak: "تناسب کم",
} as const;
export const priorityLabels = {
  unimportant: "بی‌اهمیت",
  preferred: "ترجیح می‌دهم",
  very_important: "بسیار مهم",
} as const;
export type Preference = {
  priority: keyof typeof priorityLabels;
  target: string | number | string[];
};
export type Preferences = Partial<Record<PreferenceId, Preference>>;
export const numericPreferences: Partial<
  Record<PreferenceId, { min: number; max: number; unit: string }>
> = {
  area: { min: 1, max: 100000, unit: "متر مربع دلخواه" },
  bedroom_count: { min: 0, max: 100, unit: "اتاق خواب دلخواه" },
  monthly_rent: { min: 0, max: 1e12, unit: "تومان؛ تا مبلغ دلخواه" },
  deposit: { min: 0, max: 1e12, unit: "تومان؛ تا مبلغ دلخواه" },
  construction_year: { min: 1200, max: 1500, unit: "سال شمسی؛ از سال دلخواه" },
  freshness: { min: 1, max: 365, unit: "روز؛ تایید در این مدت" },
};
export function readPreferences(raw: string | null): Preferences {
  try {
    if (!raw || raw.length > 4096) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const result: Preferences = {};
    for (const id of Object.keys(preferenceLabels) as PreferenceId[]) {
      const value: unknown = (data as Record<string, unknown>)[id];
      if (!value || typeof value !== "object") continue;
      const { priority, target } = value as Record<string, unknown>;
      if (
        typeof priority !== "string" ||
        !Object.hasOwn(priorityLabels, priority)
      )
        continue;
      if (
        typeof target !== "string" &&
        typeof target !== "number" &&
        !(
          Array.isArray(target) &&
          target.length <= 22 &&
          target.every((item) => typeof item === "string")
        )
      )
        continue;
      result[id] = {
        priority: priority as Preference["priority"],
        target,
      };
    }
    return result;
  } catch {
    return {};
  }
}
