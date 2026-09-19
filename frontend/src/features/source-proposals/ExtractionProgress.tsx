import { discoveryStopLabels } from "./discovery-labels";
import type { components } from "@/lib/api/schema";

type Request = components["schemas"]["ExtractionRequest"];
const stages = [
  ["discovering", "کشف و شناسایی صفحات"],
  ["extracting", "استخراج اطلاعات آگهی‌ها"],
  ["preparing", "اعتبارسنجی و آماده‌سازی نتایج"],
] as const;

export function extractionStateLabel(request: Request): string {
  if (request.state === "running")
    return (
      stages.find(([stage]) => stage === request.run?.stage)?.[1] ??
      "در حال استخراج"
    );
  return {
    queued: "در صف پردازش",
    complete: "پردازش پایان یافت",
    failed: "ناموفق",
    cancelled: "لغوشده",
  }[request.state];
}

export function ExtractionProgress({ request }: { request: Request }) {
  const run = request.run;
  const active = request.state === "running" || request.state === "queued";
  const current = stages.findIndex(([stage]) => stage === run?.stage);
  const number = (value: number | null | undefined) =>
    value == null ? "—" : value.toLocaleString("fa-IR");
  return (
    <section
      aria-label="پیشرفت پردازش"
      className="bg-muted/30 grid gap-4 rounded-xl border p-4"
    >
      <div aria-live="polite">
        <h4 className="font-semibold">{extractionStateLabel(request)}</h4>
        {request.state === "queued" && (
          <p className="text-muted-foreground mt-2 text-sm">
            در انتظار شروع پردازش؛ اگر دریافت قبلا شروع شده باشد از آخرین نقطه
            ذخیره‌شده ادامه پیدا می‌کند.
          </p>
        )}
        {active && run?.stage === "discovering" && (
          <p className="text-muted-foreground mt-2 text-sm">
            ابتدا صفحات دریافت و آگهی‌های اجاره شناسایی می‌شوند. استخراج اطلاعات
            و ساخت نتایج پس از پایان این مرحله شروع می‌شود.
          </p>
        )}
        {active && run?.stage === "extracting" && (
          <p className="text-muted-foreground mt-2 text-sm">
            پروفایل تأییدشده روی صفحات آگهی اجرا می‌شود تا اطلاعات ملک و شرایط
            اجاره استخراج شود.
          </p>
        )}
        {active && run?.stage === "preparing" && (
          <p className="text-muted-foreground mt-2 text-sm">
            نتایج اعتبارسنجی و آماده می‌شوند؛ انتشار طبق روش انتخاب‌شده انجام
            می‌شود.
          </p>
        )}
        {request.state === "complete" && (
          <p className="text-muted-foreground mt-2 text-sm">
            {number(run?.ready_count ?? 0)} آگهی آماده تأیید ·{" "}
            {number(run?.needs_attention ?? 0)} نتیجه نیازمند بررسی ·{" "}
            {number(run?.published ?? 0)} انتشار موفق
          </p>
        )}
      </div>
      <ol aria-label="مراحل پردازش" className="grid gap-2 sm:grid-cols-3">
        {stages.map(([stage, label], index) => (
          <li
            key={stage}
            aria-current={active && current === index ? "step" : undefined}
            className={`rounded-lg border p-3 text-sm ${active && current === index ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground"}`}
          >
            {number(index + 1)}. {label}
            <span className="mt-1 block text-xs">
              {request.state === "complete" || index < current
                ? "انجام شد"
                : active && index === current
                  ? request.state === "queued"
                    ? "در انتظار ادامه"
                    : "در حال انجام"
                  : active
                    ? "در انتظار"
                    : "متوقف"}
            </span>
          </li>
        ))}
      </ol>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">صفحات بررسی‌شده / سقف</dt>
          <dd className="mt-1 font-medium">
            {number(run?.attempted_pages)} / {number(request.max_pages)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">آگهی شناسایی‌شده / هدف</dt>
          <dd className="mt-1 font-medium">
            {number(run?.discovered)} / {number(request.target_detail_pages)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">آگهی استخراج‌شده</dt>
          <dd className="mt-1 font-medium">{number(run?.extracted)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">انتشار موفق</dt>
          <dd className="mt-1 font-medium">{number(run?.published)}</dd>
        </div>
      </dl>
      {request.state === "complete" && run?.discovery_stop_reason && (
        <p className="text-muted-foreground text-sm">
          {discoveryStopLabels[run.discovery_stop_reason]}
        </p>
      )}
      {run?.progress_updated_at && active && (
        <p className="text-muted-foreground text-xs">
          آخرین گزارش پیشرفت:{" "}
          <time dateTime={run.progress_updated_at}>
            {new Date(run.progress_updated_at).toLocaleString("fa-IR")}
          </time>
          ؛ شمارنده‌ها هنگام دریافت صفحات به‌روز می‌شوند.
        </p>
      )}
    </section>
  );
}
