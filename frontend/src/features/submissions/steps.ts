export const submissionSteps = [
  { id: "location", label: "نشانی ملک" },
  { id: "property_facts", label: "مشخصات ملک" },
  { id: "rental_terms", label: "شرایط اجاره" },
  { id: "features_description", label: "امکانات و توضیحات" },
  { id: "images", label: "تصاویر" },
  { id: "contact", label: "اطلاعات تماس" },
  { id: "review", label: "بازبینی" },
] as const;

export type SubmissionStepId = (typeof submissionSteps)[number]["id"];

export function submissionStepLabel(step: SubmissionStepId) {
  return submissionSteps.find((item) => item.id === step)?.label ?? "نشانی ملک";
}
