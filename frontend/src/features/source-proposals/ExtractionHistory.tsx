import { discoveryStopLabels } from "./discovery-labels";
import { ExtractionRunReview } from "./ExtractionRunReview";
import type { components } from "@/lib/api/schema";

const stateLabels: Record<string, string> = {
  queued: "در صف",
  running: "در حال استخراج",
  complete: "پایان یافته",
  failed: "ناموفق",
  cancelled: "لغوشده",
};
const counters = {
  attempted_pages: "صفحه‌های پردازش‌شده خارج از محدودیت",
  usable_results: "نتایج قابل استفاده",
  discovered: "کشف‌شده",
  extracted: "استخراج‌شده",
  published: "منتشرشده",
  needs_attention: "نیازمند توجه",
  rejected: "ردشده",
  failed: "ناموفق",
} as const;

export function ExtractionHistory({
  requests,
  review,
}: {
  review?: { proposalId: string; canApprove: boolean };
  requests: components["schemas"]["ExtractionRequest"][];
}) {
  return (
    <section className="mt-4 grid gap-3" aria-label="درخواست‌های اخیر استخراج">
      <h4 className="font-semibold">درخواست‌های اخیر استخراج</h4>
      {requests.length === 0 && <p>هنوز درخواست استخراجی ثبت نشده است.</p>}
      {requests.map((request) => (
        <article
          key={request.id}
          className="grid gap-2 rounded-lg border p-3 text-sm"
        >
          <p dir="ltr" className="break-all">
            {request.canonical_url}
          </p>
          <p>{stateLabels[request.state]}</p>
          {request.target_detail_pages != null && (
            <p>
              هدف: {request.target_detail_pages.toLocaleString("fa-IR")} آگهی
              اجاره؛ سقف بررسی: {request.max_pages?.toLocaleString("fa-IR")}{" "}
              صفحه
            </p>
          )}
          {request.is_current === false && (
            <p>سابقه استخراج؛ مجوز انتشار این نتایج پایان یافته است.</p>
          )}
          <time dateTime={request.created_at}>
            {new Date(request.created_at).toLocaleString("fa-IR")}
          </time>
          {request.run && (
            <>
              {request.run.discovery_stop_reason && (
                <p>{discoveryStopLabels[request.run.discovery_stop_reason]}</p>
              )}
              <p>تعداد تلاش: {request.run.attempts.toLocaleString("fa-IR")}</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(counters).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {request.run![
                        key as keyof typeof counters
                      ]?.toLocaleString("fa-IR") ?? "ثبت نشده"}
                    </dd>
                  </div>
                ))}
              </dl>
              {(request.run.skipped_pages ?? []).map((page) => (
                <p key={page.url} className="break-all">
                  کنار گذاشته شده: <bdi dir="ltr">{page.url}</bdi> ·{" "}
                  {page.reason}
                </p>
              ))}
              {(request.run.candidates ?? [])
                .filter(
                  (candidate) =>
                    candidate.exclusion_hold && candidate.state !== "published",
                )
                .map((candidate) => (
                  <p key={candidate.id} className="break-all">
                    انتشار متوقف: <bdi dir="ltr">{candidate.external_url}</bdi>{" "}
                    ·{" "}
                    {candidate.exclusion_reason ||
                      "محدودیت برداشته شده؛ انتشار این نتیجه نیازمند تأیید صریح است."}
                  </p>
                ))}
              {review && (
                <ExtractionRunReview
                  run={request.run}
                  {...review}
                  canApprove={review.canApprove && request.is_current !== false}
                />
              )}
              {request.run.errors.map((error, index) => (
                <p key={index}>
                  {error.transient && <strong>خطای موقت</strong>} {error.detail}
                </p>
              ))}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
