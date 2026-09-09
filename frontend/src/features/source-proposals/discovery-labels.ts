import type { SourceProposal } from "./queries";

export const discoveryStageLabels: Record<
  NonNullable<SourceProposal["discovery_stage"]>,
  string
> = {
  awaiting_url: "در انتظار تأیید نشانی",
  queued: "در انتظار شروع کشف",
  running: "در حال کشف صفحات",
  complete: "کشف پایان یافت؛ در انتظار بررسی پروفایل",
  failed: "کشف ناموفق؛ نیازمند بررسی اپراتور",
  released: "رزرو آزاد شد؛ در انتظار بررسی دوباره",
};

export const classificationLabels: Record<string, string> = {
  rental_listing: "آگهی اجاره",
  rental_index: "فهرست اجاره",
  other_property: "ملک خارج از دامنه اجاره",
  irrelevant: "نامرتبط",
  blocked: "دسترسی مسدود",
  fetch_error: "دریافت ناموفق",
};

export const discoveryStopLabels: Record<string, string> = {
  target_reached: "تعداد آگهی هدف پیدا شد.",
  page_limit: "سقف صفحات بررسی‌شده تکمیل شد.",
  depth_limit: "صفحه تازه‌ای در محدوده پیمایش باقی نماند.",
  frontier_exhausted: "پیوند تازه‌ای برای ادامه پیدا نشد.",
  time_slice: "پیشرفت ذخیره شد؛ ادامه پردازش در صف است.",
};
