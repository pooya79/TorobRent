import type { SupportClassification } from "@/features/support/queries";

export const supportClassificationLabels = {
  unclassified: "دسته‌بندی‌نشده",
  guidance: "راهنمایی",
  privacy: "حریم خصوصی",
  account_deletion: "حذف حساب",
  spam: "هرزنامه",
} satisfies Record<SupportClassification, string>;
