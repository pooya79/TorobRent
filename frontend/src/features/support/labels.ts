import type { SupportClassification } from "@/features/support/queries";

export const supportClassificationLabels = {
  unclassified: "دسته‌بندی‌نشده",
  guidance: "راهنمایی",
  privacy: "حریم خصوصی",
  account_deletion: "حذف حساب",
  spam: "هرزنامه",
} satisfies Record<SupportClassification, string>;

export const supportResolutionLabels = {
  answered_externally: "پاسخ بیرون از ترب‌رنت",
  action_completed: "اقدام تکمیل شد",
  duplicate: "تکراری",
  spam: "هرزنامه",
  no_action_required: "بدون اقدام لازم",
} as const;
