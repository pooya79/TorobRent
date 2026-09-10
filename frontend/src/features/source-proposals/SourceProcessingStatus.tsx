import { Activity, PauseCircle, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OperatorSourceProposal } from "./queries";

export function SourceProcessingStatus({
  proposal,
  onResults,
  updatedAt,
  stale,
}: {
  proposal: OperatorSourceProposal;
  onResults: () => void;
  updatedAt?: number;
  stale?: boolean;
}) {
  const assignment = proposal.assignment;
  if (!assignment)
    return (
      <p className="text-muted-foreground text-sm">
        پس از تأیید پروفایل منبع، وضعیت استخراج و تنظیمات انتشار اینجا نمایش
        داده می‌شود.
      </p>
    );
  const requests = [...(assignment.recent_requests ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const current = requests.filter((request) => request.is_current !== false);
  const running = current.find((request) => request.state === "running");
  const queued = current.find((request) => request.state === "queued");
  const latest = running ?? queued ?? current[0] ?? requests[0];
  const paused = assignment.source.processing_paused;
  const active = assignment.state === "active";
  const title = !active
    ? "تخصیص غیرفعال"
    : paused
      ? "متوقف"
      : running
        ? "در حال استخراج"
        : queued
          ? "در صف شروع استخراج"
          : latest?.state === "failed" && latest.is_current !== false
            ? "آخرین استخراج ناموفق بود"
            : "استخراجی در درخواست‌های اخیر در حال اجرا نیست";
  const description = !active
    ? "برای پردازش به تخصیص فعال و پروفایل تأییدشده نیاز است."
    : paused
      ? "دریافت صفحات و انتشار نتایج ناتمام متوقف است. برای ادامه، استخراج تازه را شروع کنید."
      : running
        ? "سامانه این درخواست را در حال اجرا گزارش کرده است. شمارنده‌ها با ثبت پیشرفت به‌روز می‌شوند."
        : queued
          ? "درخواست ثبت شده و منتظر شروع است؛ هنوز اجرای آن گزارش نشده است."
          : "پردازش مجاز است، اما این به معنی اجرای همیشگی نیست. استخراج با ثبت درخواست انجام می‌شود.";
  return (
    <section aria-label="وضعیت فعلی پردازش" className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-muted/30 grid content-start gap-3 rounded-xl border p-4">
          <h3 className="text-muted-foreground flex items-center gap-2 text-sm">
            {paused ? (
              <PauseCircle className="size-5" aria-hidden="true" />
            ) : (
              <Activity className="size-5" aria-hidden="true" />
            )}
            آخرین وضعیت گزارش‌شده
          </h3>
          <p role="status" className="text-lg font-semibold">
            {title}
          </p>
          <p className="text-muted-foreground text-sm">{description}</p>
          {updatedAt ? (
            <p className="text-muted-foreground text-xs">
              آخرین دریافت وضعیت:{" "}
              <time dateTime={new Date(updatedAt).toISOString()}>
                {new Date(updatedAt).toLocaleString("fa-IR")}
              </time>
            </p>
          ) : null}
          {stale ? (
            <p role="alert" className="text-destructive text-sm">
              دریافت وضعیت تازه ممکن نشد؛ اطلاعات نمایش‌داده‌شده ممکن است قدیمی
              باشد.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              هنگام باز بودن صفحه، وضعیت هر ۵ ثانیه بررسی می‌شود.
            </p>
          )}
        </div>
        <div className="bg-muted/30 grid content-start gap-3 rounded-xl border p-4">
          <h3 className="text-muted-foreground flex items-center gap-2 text-sm">
            <Workflow className="size-5" aria-hidden="true" />
            روش انتشار ذخیره‌شده
          </h3>
          <p className="text-lg font-semibold">
            {assignment.review_mode === "automatic"
              ? "خودکار"
              : assignment.review_mode === "approval_required"
                ? "پس از تأیید اپراتور"
                : "تعیین نشده"}
          </p>
          <p className="text-muted-foreground text-sm">
            {assignment.review_mode === "automatic"
              ? "نتایج معتبر درخواست‌های دارای مجوز خودکار منتشر می‌شوند. موارد مشکل‌دار برای بررسی باقی می‌مانند."
              : "اطلاعات از سایت استخراج می‌شود، اما انتشار نتایج به تأیید اپراتور نیاز دارد."}
          </p>
          <p className="text-muted-foreground text-sm">
            این تنظیم مشخص می‌کند نتیجه چه زمانی منتشر شود؛ استخراج را شروع یا
            متوقف نمی‌کند.
          </p>
        </div>
      </div>
      {["queued", "running"].includes(proposal.discovery_stage ?? "") && (
        <p className="bg-muted/30 rounded-lg p-3 text-sm">
          کشف صفحات برای بررسی پروفایل هم در جریان است. پیشرفت این مرحله را در
          تب نشانی و کشف ببینید.
        </p>
      )}
      {latest ? (
        <div className="grid gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">
              {running || queued
                ? paused || !active
                  ? "آخرین وضعیت درخواست پیش از توقف"
                  : "درخواست در حال پیگیری"
                : "آخرین درخواست استخراج"}
            </h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onResults}
            >
              مشاهده نتایج و خطاها
            </Button>
          </div>
          <p dir="ltr" className="text-start text-sm break-all">
            {latest.canonical_url}
          </p>
          <p className="text-muted-foreground text-sm">
            وضعیت ثبت‌شده درخواست:{" "}
            {
              {
                queued: "در صف",
                running: "در حال اجرا",
                complete: "پایان یافته",
                failed: "ناموفق",
                cancelled: "لغوشده",
              }[latest.state]
            }
            {latest.is_current === false
              ? " · مربوط به پردازش قبلی؛ مجوز انتشار ندارد"
              : ""}
          </p>
          {latest.updated_at && (
            <p className="text-muted-foreground text-xs">
              آخرین تغییر درخواست:{" "}
              <time dateTime={latest.updated_at}>
                {new Date(latest.updated_at).toLocaleString("fa-IR")}
              </time>
            </p>
          )}
          {latest.run?.candidates?.some(
            (candidate) =>
              candidate.state === "pending" && !candidate.superseded,
          ) &&
            latest.is_current !== false &&
            active &&
            !paused && (
              <p className="bg-primary/5 rounded-lg p-3 text-sm">
                این درخواست نتیجه در انتظار بررسی دارد. برای بررسی و تأیید
                انتشار، «مشاهده نتایج و خطاها» را باز کنید.
              </p>
            )}
          {latest.run && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["صفحه بررسی‌شده", latest.run.attempted_pages],
                  ["آگهی استخراج‌شده", latest.run.extracted],
                  ["منتشرشده", latest.run.published],
                  ["نیازمند رسیدگی", latest.run.needs_attention],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-muted/30 rounded-lg p-3">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="mt-2 text-xl font-semibold">
                    {value == null ? "—" : value.toLocaleString("fa-IR")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {latest.run?.errors?.length ? (
            <p className="text-destructive text-sm">
              آخرین خطای ثبت‌شده:{" "}
              {latest.run.errors[latest.run.errors.length - 1]?.detail}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          هنوز درخواست استخراجی ثبت نشده است. نماینده منبع می‌تواند درخواست
          استخراج ثبت کند.
        </p>
      )}
    </section>
  );
}
