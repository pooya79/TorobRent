import type { components } from "@/lib/api/schema";

export function SourceAssignmentSummary({
  assignment,
}: {
  assignment: components["schemas"]["SourceAssignment"];
}) {
  return (
    <section
      className="bg-muted/40 mt-4 grid gap-2 rounded-lg border p-4 text-sm"
      aria-label="تخصیص منبع"
    >
      <h4 className="font-semibold">
        {assignment.state === "active"
          ? "تخصیص منبع فعال است"
          : "تخصیص منبع لغو شده است"}
      </h4>
      <p>{assignment.source.display_name}</p>
      <p className="text-start break-all" dir="ltr">
        {assignment.source.domain}
      </p>
      <p>
        {assignment.active_profile_version
          ? `نسخه فعال پروفایل: ${assignment.active_profile_version.number.toLocaleString("fa-IR")}`
          : "پروفایل فعالی برای این تخصیص وجود ندارد."}
      </p>
      {assignment.state === "active" && (
        <p>
          {assignment.review_mode === "automatic"
            ? "نتایج معتبر هر بار استخراج می‌تواند خودکار منتشر شود."
            : assignment.review_mode === "approval_required"
              ? "نتایج هر بار استخراج نیازمند تأیید اپراتور است."
              : "روش بررسی برای این تخصیص ثبت نشده است."}
        </p>
      )}
    </section>
  );
}
