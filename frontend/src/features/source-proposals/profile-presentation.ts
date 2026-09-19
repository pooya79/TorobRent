import { propertyTypeLabels } from "@/features/catalog/property-taxonomy";

export const fields: Record<string, string> = {
  city: "شهر",
  district: "منطقه",
  neighborhood: "محله",
  property_type: "نوع ملک",
  floor_area_sqm: "متراژ",
  bedroom_count: "اتاق خواب",
  deposit_rial: "رهن",
  monthly_rent_rial: "اجاره ماهانه",
  construction_year: "سال ساخت",
  floor: "طبقه",
  total_floors: "تعداد طبقات",
  units_per_floor: "واحد در طبقه",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
  heating: "گرمایش",
  cooling: "سرمایش",
  is_negotiable: "قابل مذاکره",
  is_convertible: "قابل تبدیل",
  title: "عنوان",
  description: "توضیحات",
  source_reference: "شناسه آگهی",
  source_url: "نشانی آگهی",
  published_at: "زمان انتشار",
  availability_confirmed_at: "تأیید موجود بودن",
  latitude: "عرض جغرافیایی",
  longitude: "طول جغرافیایی",
  source_location_text: "متن موقعیت",
  image_urls: "نشانی تصاویر",
};

export function display(value: unknown): string {
  const labels: Record<string, string> = {
    ...propertyTypeLabels,
    unknown: "نامشخص",
    present: "دارد",
    absent: "ندارد",
  };
  if (typeof value === "string") return labels[value] ?? value;
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  if (value == null) return "ثبت نشده";
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  if (Array.isArray(value)) return value.map(display).join("، ") || "ثبت نشده";
  if (typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, item]: [string, unknown]) =>
          `${fields[key] ?? key}: ${display(item)}`,
      )
      .join(" · ");
  return "—";
}

export function displayField(field: string, value: unknown): string {
  if (
    ["deposit_rial", "monthly_rent_rial"].includes(field) &&
    typeof value === "number"
  ) {
    return `${(value / 10).toLocaleString("fa-IR")} تومان`;
  }
  return display(value);
}
