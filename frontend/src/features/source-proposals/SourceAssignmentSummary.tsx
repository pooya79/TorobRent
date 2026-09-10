import { ExtractionRequestForm } from "./ExtractionRequestForm";
import type { components } from "@/lib/api/schema";

export function SourceAssignmentSummary({
  assignment,
  proposalId,
}: {
  proposalId?: string;
  assignment: components["schemas"]["SourceAssignment"];
}) {
  const active = assignment.state === "active";
  const paused = assignment.source.processing_paused;
  const requests = [...(assignment.recent_requests ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const processing =
    active &&
    !paused &&
    requests.some(
      (request) =>
        request.is_current !== false &&
        ["queued", "running"].includes(request.state),
    );
  return (
    <section
      className="mt-4 grid gap-4 text-sm"
      aria-label="نتیجه بررسی وب‌سایت"
    >
      <div className="bg-muted/40 grid gap-2 rounded-xl border p-4">
        <h2 className="font-semibold">
          {active
            ? "وب‌سایت تأیید شده است"
            : "همکاری با این وب‌سایت پایان یافته است"}
        </h2>
        <p role="status">
          {!active
            ? "برای معرفی وب‌سایت تازه به داشبورد بروید."
            : paused
              ? "بررسی آگهی‌های تازه موقتاً متوقف است."
              : processing
                ? "در حال بررسی آگهی‌های وب‌سایت شما هستیم. فعلاً نیازی به اقدام شما نیست."
                : "نتیجه درخواست‌های شما در همین صفحه نمایش داده می‌شود."}
        </p>
        {paused && active && (
          <p className="text-muted-foreground">
            برای پیگیری با تیم بررسی تماس بگیرید. آگهی‌های منتشرشده تا پایان
            اعتبارشان باقی می‌مانند.
          </p>
        )}
      </div>
      {requests.length > 0 ? (
        <section aria-label="نتیجه درخواست‌های اخیر" className="grid gap-3">
          <h3 className="font-medium">درخواست‌های اخیر</h3>
          <ul className="divide-y rounded-xl border">
            {requests.map((request) => {
              const published = request.run?.published;
              const urls = [
                ...new Set(
                  (request.run?.candidates ?? [])
                    .filter((candidate) => candidate.state === "published")
                    .map((candidate) => candidate.external_url),
                ),
              ];
              const status =
                !active || request.is_current === false
                  ? "درخواست قبلی"
                  : paused && ["queued", "running"].includes(request.state)
                    ? "متوقف شده"
                    : {
                        queued: "در انتظار بررسی",
                        running: "در حال بررسی",
                        complete: "بررسی پایان یافت",
                        failed: "بررسی کامل نشد",
                        cancelled: "متوقف شده",
                      }[request.state];
              return (
                <li key={request.id} className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{status}</p>
                    <time
                      className="text-muted-foreground text-xs"
                      dateTime={request.created_at}
                    >
                      {new Date(request.created_at).toLocaleDateString("fa-IR")}
                    </time>
                  </div>
                  <p
                    dir="ltr"
                    className="text-muted-foreground text-start break-all"
                  >
                    {request.canonical_url}
                  </p>
                  <p>
                    {published == null
                      ? "هنوز نتیجه‌ای ثبت نشده است."
                      : `${published.toLocaleString("fa-IR")} آگهی در این درخواست منتشر شده است.`}
                  </p>
                  {request.state === "failed" &&
                    active &&
                    request.is_current !== false && (
                      <p className="text-muted-foreground">
                        برای پیگیری این درخواست با تیم بررسی تماس بگیرید.
                      </p>
                    )}
                  {urls.length > 0 && (
                    <details>
                      <summary className="text-primary cursor-pointer">
                        مشاهده نشانی آگهی‌های منتشرشده
                      </summary>
                      <p className="text-muted-foreground mt-3 text-xs">
                        نتیجه انتشار در زمان این درخواست؛ ممکن است اعتبار
                        آگهی‌ها بعداً پایان یافته باشد.
                      </p>
                      <ul className="mt-3 grid gap-2">
                        {urls.map((url) => (
                          <li key={url}>
                            <a
                              href={/^https?:\/\//i.test(url) ? url : undefined}
                              target="_blank"
                              rel="noreferrer"
                              dir="ltr"
                              className="block text-start break-all underline underline-offset-4"
                            >
                              {url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-muted-foreground">
          هنوز نتیجه‌ای برای نمایش نداریم.
        </p>
      )}
      {proposalId && active && !paused && assignment.active_profile_version && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">
            معرفی صفحه تازه از همین وب‌سایت
          </summary>
          <p className="text-muted-foreground mt-3">
            نشانی صفحه آگهی یا فهرست آگهی‌ها را وارد کنید تا بررسی شود.
          </p>
          <ExtractionRequestForm
            proposalId={proposalId}
            assignmentId={assignment.id}
          />
        </details>
      )}
    </section>
  );
}
