import type { ExternalListingCandidate } from "./queries";

export const candidateFieldLabels: Record<string, string> = {
  city: "شهر",
  district: "منطقه",
  neighborhood: "محله",
  property_type: "نوع ملک",
  floor_area_sqm: "متراژ",
  area_sqm: "متراژ",
  bedroom_count: "اتاق خواب",
  room_count: "اتاق خواب",
  deposit_rial: "رهن",
  monthly_rent_rial: "اجاره ماهانه",
  title: "عنوان",
  description: "توضیحات",
  structure: "ساختار صفحه",
};

export function candidateValidationMessages(
  candidate: ExternalListingCandidate,
) {
  return Object.entries(candidate.validation_errors ?? {}).flatMap(
    ([field, value]) =>
      (Array.isArray(value) ? value.map(String) : [String(value)]).map(
        (message) => {
          const detail = [
            "This field cannot be null.",
            "This field is required.",
            "این مقدار برای انتشار الزامی است.",
          ].includes(message)
            ? "ثبت نشده است."
            : message;
          return `${candidateFieldLabels[field] ?? field}: ${detail}`;
        },
      ),
  );
}
