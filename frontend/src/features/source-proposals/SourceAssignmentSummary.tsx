import { SourceBulkActions } from "./SourceBulkActions";
import { SourceExceptionsPanel } from "./SourceExceptionsPanel";
import { SourceExclusionsSummary } from "./SourceExclusionsPanel";
import { ExtractionHistory } from "./ExtractionHistory";
import { ExtractionRequestForm } from "./ExtractionRequestForm";
import type { components } from "@/lib/api/schema";

export function SourceAssignmentSummary({
  assignment,
  proposalId,
  review,
}: {
  review?: { proposalId: string; canApprove: boolean };
  proposalId?: string;
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
      {assignment.state === "active" && (
        <p role="status">
          {assignment.source.processing_paused
            ? "پردازش منبع متوقف است."
            : "پردازش منبع فعال است."}
        </p>
      )}
      {assignment.source.processing_paused && (
        <p>
          استخراج و انتشار نتایج ناتمام تا ازسرگیری توسط اپراتور متوقف است.
          آگهی‌های منتشرشده اعتبار معمول خود را دارند.
        </p>
      )}
      <p className="text-start break-all" dir="ltr">
        {assignment.source.domain}
      </p>
      <p>
        {assignment.active_profile_version
          ? `نسخه فعال پروفایل: ${assignment.active_profile_version.number.toLocaleString("fa-IR")}`
          : "پروفایل فعالی برای این تخصیص وجود ندارد."}
      </p>
      {assignment.state === "active" &&
        !assignment.source.processing_paused && (
          <p>
            {assignment.review_mode === "automatic"
              ? "نتایج معتبر درخواست‌های تازه خودکار منتشر می‌شود."
              : assignment.review_mode === "approval_required"
                ? "نتایج هر بار استخراج نیازمند تأیید اپراتور است."
                : "روش بررسی برای این تخصیص ثبت نشده است."}
          </p>
        )}
      {assignment.target_detail_pages != null && (
        <p>
          حدود تأییدشده هر استخراج: هدف{" "}
          {assignment.target_detail_pages.toLocaleString("fa-IR")} آگهی اجاره؛
          سقف {assignment.max_pages?.toLocaleString("fa-IR")} صفحه
        </p>
      )}
      {proposalId &&
        assignment.state === "active" &&
        !assignment.source.processing_paused &&
        assignment.active_profile_version && (
          <ExtractionRequestForm
            proposalId={proposalId}
            assignmentId={assignment.id}
          />
        )}
      {review?.canApprove && assignment.state === "active" && (
        <SourceBulkActions
          key={review.proposalId}
          proposalId={review.proposalId}
          pages={assignment.current_results ?? []}
        />
      )}
      <SourceExceptionsPanel
        exceptions={assignment.exceptions ?? []}
        proposalId={proposalId ?? review?.proposalId ?? ""}
        operator={!!review}
        canRetry={
          assignment.state === "active" &&
          !assignment.source.processing_paused &&
          !!assignment.active_profile_version &&
          (!!proposalId || !!review?.canApprove)
        }
      />
      <SourceExclusionsSummary exclusions={assignment.exclusions ?? []} />
      <ExtractionHistory
        requests={assignment.recent_requests ?? []}
        review={
          review && {
            ...review,
            canApprove:
              review.canApprove && !assignment.source.processing_paused,
          }
        }
      />
    </section>
  );
}
