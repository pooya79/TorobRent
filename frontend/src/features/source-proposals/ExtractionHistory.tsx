import type { components } from "@/lib/api/schema";

const stateLabels: Record<string, string> = {
  queued: "در صف",
  running: "در حال استخراج",
  complete: "پایان یافته",
  failed: "ناموفق",
  cancelled: "لغوشده",
};
const counters = {
  discovered: "کشف‌شده",
  extracted: "استخراج‌شده",
  published: "منتشرشده",
  needs_attention: "نیازمند توجه",
  rejected: "ردشده",
  failed: "ناموفق",
} as const;

export function ExtractionHistory({
  requests,
}: {
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
          <time dateTime={request.created_at}>
            {new Date(request.created_at).toLocaleString("fa-IR")}
          </time>
          {request.run && (
            <>
              <p>تعداد تلاش: {request.run.attempts.toLocaleString("fa-IR")}</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(counters).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {request.run![
                        key as keyof typeof counters
                      ].toLocaleString("fa-IR")}
                    </dd>
                  </div>
                ))}
              </dl>
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
