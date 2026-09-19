import { CaseRecords } from "./CaseRecords";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { History, ScanText, ShieldCheck } from "lucide-react";
import { ProfileRule } from "./ProfileRule";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fields, display, displayField } from "./profile-presentation";
import { ProfileSamples, type RepairSelection } from "./ProfileSamples";
import { errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import {
  approveSourceProfile,
  editSourceProfile,
  repairSourceProfile,
  type OperatorSourceProposal,
} from "./queries";

type Version = components["schemas"]["SourceProfileVersion"];
const coreFields = Object.keys(fields).slice(0, 8);
function formatProfileDate(value?: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return "ثبت نشده";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
const selectClass = "border-input bg-background rounded-md border p-2 text-sm";

export function SourceProfileReview({
  proposal,
  canReviewSource,
  unavailableReason,
  onOpenDiscovery,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  canReviewSource: boolean;
  unavailableReason: string;
  onOpenDiscovery: () => void;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const versions = proposal.profile_versions ?? [];
  const latest = versions[0];
  const canEdit =
    canReviewSource &&
    proposal.state === "pending" &&
    proposal.discovery_stage === "complete" &&
    latest?.reservation === proposal.discovery?.id &&
    latest?.status === "proposed";
  const active = proposal.assignment?.active_profile_version;
  const [repairHistoryOpen, setRepairHistoryOpen] = useState(false);
  return (
    <section
      className="[&_summary]:focus-visible:outline-ring grid min-w-0 gap-6 [&_summary]:cursor-pointer [&_summary]:rounded-md [&_summary]:py-2 [&_summary]:font-medium [&_summary]:focus-visible:outline-2"
      aria-label="بررسی پروفایل منبع"
    >
      <header className="bg-muted/30 rounded-xl border p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <ScanText className="text-primary size-6" aria-hidden="true" />
          <h2 className="text-xl font-semibold">روش خواندن اطلاعات از سایت</h2>
        </div>
        <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-7">
          پروفایل مشخص می‌کند اطلاعاتی مثل شهر، متراژ و اجاره از کجای آگهی
          خوانده شوند. ابتدا کیفیت و نمونه‌ها را بررسی کنید؛ سپس نسخه را تأیید
          کنید یا فیلدهای نادرست را اصلاح کنید.
        </p>
      </header>
      {active && !latest?.is_active && (
        <p className="bg-muted/30 rounded-xl border p-4 text-sm">
          نسخه فعال فعلی: {active.number.toLocaleString("fa-IR")} · تا تأیید
          نسخه تازه، همین قواعد استفاده می‌شوند.
        </p>
      )}
      {canEdit && latest ? (
        <ProfileEditor
          key={latest.id}
          proposal={proposal}
          version={latest}
          onUpdate={onUpdate}
        />
      ) : (
        <>
          <div className="grid gap-3 rounded-xl border p-4 text-sm leading-7">
            <p role="status">
              {!canReviewSource
                ? unavailableReason
                : proposal.state === "approved"
                  ? "این منبع تأیید شده است. برای تغییر قواعد، بررسی تازه‌ای آغاز کنید؛ نسخه فعال تا تأیید نسخه جایگزین برقرار می‌ماند."
                  : proposal.state !== "pending"
                    ? "این پرونده در انتظار بررسی نیست؛ تصمیم ثبت‌شده را در سوابق ببینید."
                    : ["queued", "running"].includes(
                          proposal.discovery_stage ?? "",
                        )
                      ? "دریافت و بررسی صفحات در حال انجام است؛ پس از پایان، نسخه پیشنهادی اینجا نمایش داده می‌شود."
                      : "هنوز نسخه‌ای آماده تصمیم‌گیری نیست. وضعیت نشانی و کشف صفحات را بررسی کنید."}
            </p>
            {proposal.discovery?.evidence.profile_failure && (
              <p role="alert">{proposal.discovery.evidence.profile_failure}</p>
            )}
            <Button variant="outline" onClick={onOpenDiscovery}>
              {proposal.state === "approved" && canReviewSource
                ? "بهبود استخراج"
                : "مشاهده وضعیت نشانی و کشف"}
            </Button>
          </div>
          {latest && <ProfileEvidence key={latest.id} version={latest} />}
        </>
      )}
      <details
        onToggle={(event) => setRepairHistoryOpen(event.currentTarget.open)}
        className="rounded-xl border p-4"
      >
        <summary>تاریخچه اصلاح هوشمند</summary>
        {repairHistoryOpen && (
          <section
            className="bg-card rounded-xl border p-5 sm:p-6"
            aria-label="تاریخچه اصلاح هوشمند"
          >
            <div className="mb-5 flex items-start gap-3">
              <History
                className="text-muted-foreground mt-1 size-5 shrink-0"
                aria-hidden="true"
              />
              <div>
                <h4 className="font-semibold">تاریخچه اصلاح هوشمند</h4>
                <p className="text-muted-foreground mt-1 text-sm leading-7">
                  هر درخواست، روش خواندن فیلدهای انتخاب‌شده از سایت را بازبینی
                  می‌کند. نسخه پیشنهادی فقط پس از بررسی و تأیید شما فعال می‌شود.
                </p>
              </div>
              <Badge variant="secondary">
                {(proposal.profile_repairs ?? []).length.toLocaleString(
                  "fa-IR",
                )}
              </Badge>
            </div>
            <CaseRecords kind="repairs" proposalId={proposal.id}>
              {(repairs) => (
                <>
                  {!repairs?.length ? (
                    <p className="bg-muted/40 text-muted-foreground rounded-lg p-4 text-sm">
                      هنوز درخواستی برای اصلاح هوشمند ثبت نشده است.
                    </p>
                  ) : (
                    <ol className="grid gap-4">
                      {repairs.map((repair) => {
                        const result = versions.find(
                          (version) => version.id === repair.result_version,
                        );
                        const labels: Record<string, string> = {
                          pending: "در حال بررسی",
                          succeeded: "نسخه پیشنهادی آماده است",
                          timeout: "پایان مهلت پاسخ",
                          interrupted: "درخواست متوقف شد",
                          stale_review: "نیازمند بررسی دوباره",
                          validation_failed: "اعتبارسنجی ناموفق",
                          not_configured: "سرویس آماده نیست",
                          provider_error: "خطا در سرویس اصلاح",
                          malformed_output: "پاسخ نامعتبر",
                        };
                        return (
                          <li
                            key={repair.id}
                            className="grid gap-3 rounded-lg border p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge
                                variant={
                                  repair.outcome === "succeeded"
                                    ? "secondary"
                                    : repair.outcome === "pending"
                                      ? "outline"
                                      : "destructive"
                                }
                              >
                                {labels[repair.outcome] ?? "اصلاح انجام نشد"}
                              </Badge>
                              <time
                                className="text-muted-foreground text-xs"
                                dateTime={repair.started_at}
                              >
                                {formatProfileDate(repair.started_at)}
                              </time>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {repair.selected_fields.map((field) => (
                                <Badge key={field} variant="outline">
                                  {fields[field] ?? field}
                                </Badge>
                              ))}
                            </div>
                            <p role="status" className="text-sm leading-7">
                              {repair.detail}
                            </p>
                            {result && (
                              <p className="text-sm">
                                نسخه {result.number.toLocaleString("fa-IR")} ·{" "}
                                {result.is_active
                                  ? "نسخه فعال"
                                  : result.status === "proposed"
                                    ? "در انتظار بررسی و تأیید"
                                    : "ثبت‌شده در تاریخچه نسخه‌ها"}
                              </p>
                            )}
                            <details className="text-sm">
                              <summary>جزئیات درخواست</summary>
                              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                                <div>
                                  <dt className="text-muted-foreground">مدل</dt>
                                  <dd dir="auto" className="break-all">
                                    {repair.model || "ثبت نشده"}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    زمان پایان
                                  </dt>
                                  <dd>
                                    {formatProfileDate(repair.finished_at)}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    مدت پردازش
                                  </dt>
                                  <dd>
                                    {repair.duration_ms == null
                                      ? "ثبت نشده"
                                      : `${(repair.duration_ms / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} ثانیه`}
                                  </dd>
                                </div>
                              </dl>
                            </details>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </CaseRecords>
          </section>
        )}
      </details>
      <ProfileHistory proposalId={proposal.id} />
    </section>
  );
}

function ProfileComparison({ version }: { version: Version }) {
  if (version.provenance !== "llm" || !version.comparison) return null;
  const unchangedProblems = [
    ...new Set(
      version.samples.flatMap((sample) =>
        [
          ...new Set([...sample.unresolved, ...Object.keys(sample.conflicts)]),
        ].filter(
          (field) =>
            !version.comparison.some(
              (item) =>
                item.field === field &&
                item.samples.some(
                  (change) => change.url === sample.canonical_url,
                ),
            ),
        ),
      ),
    ),
  ];
  const resultLabels = {
    resolved: "استخراج‌شده",
    missing: "استخراج نشده",
    conflict: "نیازمند توجه",
  };
  const changeLabels = {
    improved: "بهبود",
    regressed: "پسرفت",
    changed: "تغییر مقدار یا تعارض",
  };
  function quality(
    value: components["schemas"]["ProfileFieldValidation"] | null,
  ) {
    if (!value) return "شواهد ثبت نشده";
    const coverage =
      value.coverage === null
        ? "نامشخص"
        : `${(value.coverage * 100).toLocaleString("fa-IR")}٪`;
    return `حل‌شده: ${value.resolved.toLocaleString("fa-IR")} · تعارض: ${value.conflicts.toLocaleString("fa-IR")} · پوشش: ${coverage}`;
  }
  return (
    <section
      className="grid min-w-0 gap-3 rounded-md border p-3"
      aria-label="مقایسه اصلاح"
    >
      <h4 className="font-semibold">مقایسه اصلاح با نسخه پیشین</h4>
      <p className="text-muted-foreground text-sm">
        بهبود و پسرفت نشان‌دهنده حل‌شدن یا حل‌نشده‌شدن فیلد در نمونه‌هاست؛ درستی
        واقعی مقدار را تأیید نمی‌کند.
      </p>
      {version.status === "proposed" && (
        <p className="text-sm">
          این نسخه پیش‌نویس است؛ نسخه فعال تا تأیید صریح شما تغییر نمی‌کند.
        </p>
      )}
      {unchangedProblems.length > 0 && (
        <p>
          مشکلات بدون تغییر:{" "}
          {unchangedProblems.map((field) => fields[field] ?? field).join("، ")}
        </p>
      )}
      {version.comparison.length === 0 && (
        <p>قواعد، مقادیر و وضعیت فیلدها نسبت به نسخه پیشین تغییری نکرده‌اند.</p>
      )}
      {version.comparison.map((item) => (
        <article
          key={item.field}
          className="grid min-w-0 gap-2 border-t pt-3"
          aria-label={`مقایسه ${fields[item.field] ?? item.field}`}
        >
          <h5 className="font-medium">{fields[item.field] ?? item.field}</h5>
          <p className="text-sm">
            بهبود:{" "}
            {item.samples
              .filter((sample) => sample.change === "improved")
              .length.toLocaleString("fa-IR")}{" "}
            صفحه · پسرفت:{" "}
            {item.samples
              .filter((sample) => sample.change === "regressed")
              .length.toLocaleString("fa-IR")}{" "}
            صفحه
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">پیش از اصلاح — اعتبارسنجی مستقل</dt>
              <dd>{quality(item.before_validation)}</dd>
            </div>
            <div>
              <dt className="font-medium">پس از اصلاح — اعتبارسنجی مستقل</dt>
              <dd>{quality(item.after_validation)}</dd>
            </div>
          </dl>
          <details>
            <summary>قواعد پیش و پس از اصلاح</summary>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <p>پیش از اصلاح</p>
                <ProfileRule rule={item.before_rule} />
              </div>
              <div className="min-w-0">
                <p>پس از اصلاح</p>
                <ProfileRule rule={item.after_rule} />
              </div>
            </div>
          </details>
          <details open>
            <summary>صفحات نمونه تحت تأثیر</summary>
            {item.samples.length === 0 && (
              <p className="text-sm">
                مقدار و وضعیت فیلد در نمونه‌ها تغییر نکرده است.
              </p>
            )}
            {item.samples.map((sample) => (
              <div
                key={sample.url}
                className="grid gap-2 border-t py-3 text-sm"
              >
                {/^https?:\/\//i.test(sample.url) ? (
                  <a
                    href={sample.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-all underline"
                    dir="ltr"
                  >
                    {sample.url}
                  </a>
                ) : (
                  <p dir="ltr" className="break-all">
                    {sample.url}
                  </p>
                )}
                <p>
                  <strong>{changeLabels[sample.change]}</strong> ·{" "}
                  <span>
                    {sample.split === "held_out"
                      ? "اعتبارسنجی مستقل"
                      : "نمونه آموزشی"}
                  </span>
                </p>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {(["before", "after"] as const).map((side) => (
                    <div key={side} className="min-w-0 break-words">
                      <dt className="font-medium">
                        {side === "before" ? "پیش از اصلاح" : "پس از اصلاح"} —{" "}
                        {resultLabels[sample[side].status]}
                      </dt>
                      <dd>
                        {sample[side].value == null
                          ? "—"
                          : displayField(item.field, sample[side].value)}
                      </dd>
                      {sample[side].conflicts.length > 0 && (
                        <dd>
                          مقادیر متعارض:{" "}
                          {sample[side].conflicts
                            .map((value) => displayField(item.field, value))
                            .join("، ")}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </details>
        </article>
      ))}
    </section>
  );
}

function ProfileEvidence({
  version,
  selection,
}: {
  version: Version;
  selection?: RepairSelection;
}) {
  const trainingCount = version.validation.training_page_urls.length;
  const validationCount = version.validation.held_out_page_urls.length;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 break-words">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="text-primary size-5" aria-hidden="true" />
          پروفایل منبع — نسخه {version.number.toLocaleString("fa-IR")}
        </h3>
        <Badge variant={version.is_active ? "default" : "secondary"}>
          {version.is_active
            ? "نسخه فعال"
            : version.status === "proposed"
              ? "در انتظار تأیید"
              : "نسخه پیشین"}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        {version.provenance === "llm"
          ? "اصلاح هوشمند"
          : version.provenance === "manual"
            ? "اصلاح دستی"
            : "پیشنهاد کشف"}{" "}
        · {version.created_by_label || "سامانه"}
      </p>
      {version.decision_reason && <p>{version.decision_reason}</p>}
      <p>
        {version.validation.rules_valid === true
          ? "قواعد از نظر فنی معتبر و قابل اجرا هستند."
          : version.validation.rules_valid === false
            ? "قواعد از نظر فنی قابل تأیید نیستند."
            : "اعتبار فنی این نسخه قدیمی هنگام تأیید دوباره بررسی می‌شود."}
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <div className="bg-muted/40 rounded-xl p-4">
          <dt className="text-muted-foreground text-sm">صفحات ساخت قواعد</dt>
          <dd className="mt-2 text-2xl font-semibold">
            {trainingCount.toLocaleString("fa-IR")}{" "}
            <span className="text-sm font-normal">صفحه</span>
          </dd>
        </div>
        <div className="bg-muted/40 rounded-xl p-4">
          <dt className="text-muted-foreground text-sm">اعتبارسنجی مستقل</dt>
          <dd className="mt-2 text-2xl font-semibold">
            {validationCount.toLocaleString("fa-IR")}{" "}
            <span className="text-sm font-normal">صفحه</span>
          </dd>
        </div>
      </dl>
      <div className="bg-muted/20 grid gap-2 rounded-xl border p-4 text-sm leading-7">
        {validationCount === 0 ? (
          <p className="font-semibold">بدون اعتبارسنجی مستقل</p>
        ) : trainingCount + validationCount < 10 ? (
          <p className="font-semibold">شواهد محدود</p>
        ) : null}
        {validationCount > 0 && (
          <p>
            {version.validation.quality_passed
              ? "اعتبارسنجی هشت فیلد اصلی موفق بود."
              : "کیفیت فیلدهای اصلی محدودیت دارد."}
          </p>
        )}
        {version.validation.limitations_present && (
          <p>
            نمونه‌ها یا شواهد محدودیت دارند؛ تأیید نیازمند پذیرش محدودیت‌ها و
            ثبت دلیل است.
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          این شواهد برای تصمیم شماست؛ اعتبارسنجی تضمین درستی واقعی اطلاعات نیست.
          هر نتیجه پیش از انتشار جداگانه بررسی می‌شود.
        </p>
        {version.limitations_acknowledged && (
          <p>محدودیت‌های کیفیت هنگام تأیید پذیرفته شد.</p>
        )}
      </div>
      <ProfileComparison version={version} />
      <ProfileSamples
        key={version.id}
        version={version}
        selection={selection}
      />
      <details className="rounded-xl border p-4">
        <summary>گزارش فنی و قواعد استخراج</summary>
        <details>
          <summary>یافته‌های هر صفحه اعتبارسنجی</summary>
          {(version.validation.pages ?? []).map((page) => (
            <div key={page.url} className="grid gap-1 border-b py-2 text-sm">
              <p dir="ltr" className="break-all">
                {page.url}
              </p>
              <p>
                {page.unresolved.length || Object.keys(page.conflicts).length
                  ? "نیازمند بررسی"
                  : "بدون فیلد اصلی حل‌نشده یا متعارض"}
              </p>
              <p>
                فیلدهای حل‌نشده:{" "}
                {page.unresolved
                  .map((field) => fields[field] ?? field)
                  .join("، ") || "ندارد"}
              </p>
              {Object.entries(page.conflicts).map(([field, values]) => (
                <p key={field}>
                  تعارض {fields[field] ?? field}:{" "}
                  {values.map((value) => displayField(field, value)).join("، ")}
                </p>
              ))}
            </div>
          ))}
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            گزارش پوشش و تعارض فیلدها
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-start text-sm">
              <caption className="text-start font-medium">
                پوشش فیلدها در صفحات کنارگذاشته‌شده برای اعتبارسنجی
              </caption>
              <thead>
                <tr>
                  <th className="text-start">فیلد</th>
                  <th>پوشش</th>
                  <th>تعارض</th>
                  <th>نتیجه</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(version.validation.fields).map(
                  ([field, report]) => (
                    <tr key={field}>
                      <th className="py-1 text-start font-normal">
                        {fields[field] ?? field}
                        {coreFields.includes(field) ? " (اصلی)" : " (اختیاری)"}
                      </th>
                      <td className="text-center">
                        {validationCount === 0 || report.coverage === null
                          ? "—"
                          : `${Math.round(report.coverage * 100).toLocaleString("fa-IR")}٪`}
                      </td>
                      <td className="text-center">
                        {report.conflicts.toLocaleString("fa-IR")}
                      </td>
                      <td className="text-center">
                        {validationCount === 0 || report.passed === null
                          ? "ارزیابی نشده"
                          : report.passed
                            ? "موفق"
                            : "نیازمند بررسی"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>صفحات آموزش و اعتبارسنجی</summary>
          <p>آموزش</p>
          {version.validation.training_page_urls.map((url) => (
            <p className="break-all" dir="ltr" key={url}>
              {url}
            </p>
          ))}
          <p>اعتبارسنجی مستقل</p>
          {version.validation.held_out_page_urls.map((url) => (
            <p className="break-all" dir="ltr" key={url}>
              {url}
            </p>
          ))}
        </details>
        <details>
          <summary>قواعد این نسخه</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Object.entries(
              (version.rules ?? {}) as Record<string, unknown>,
            ).map(([field, rule]) => (
              <article key={field} className="min-w-0 rounded-lg border p-4">
                <h5 className="mb-3 font-medium">{fields[field] ?? field}</h5>
                <ProfileRule rule={rule} />
              </article>
            ))}
          </div>
        </details>
      </details>
      {Array.isArray(version.exclusions) && version.exclusions.length > 0 && (
        <div>
          <h4>ساختارهای کنارگذاشته‌شده</h4>
          {version.exclusions.map((url, i) => (
            <p key={i} className="break-all" dir="ltr">
              {display(url)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  proposal,
  version,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  version: Version;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const actionPanel = useRef<HTMLDivElement>(null);
  const [editorAction, setEditorAction] = useState("");
  useEffect(() => {
    if (!editorAction) return;
    actionPanel.current?.focus({ preventScroll: true });
    actionPanel.current?.scrollIntoView?.({
      block: "start",
      behavior: "instant",
    });
  }, [editorAction]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [field, setField] = useState("city");
  const [kind, setKind] = useState("css");
  const [locator, setLocator] = useState("");
  const [attribute, setAttribute] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [limitationsAcknowledged, setLimitationsAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const hasLimitations = version.validation.limitations_present;
  const [mode, setMode] = useState<"" | "approval_required" | "automatic">("");
  const transform = [
    "floor_area_sqm",
    "bedroom_count",
    "construction_year",
    "floor",
    "total_floors",
    "units_per_floor",
  ].includes(field)
    ? "integer"
    : ["deposit_rial", "monthly_rent_rial"].includes(field)
      ? "money_rial"
      : field === "property_type"
        ? "property_type"
        : ["parking", "elevator", "storage", "balcony", "furnished"].includes(
              field,
            )
          ? "feature"
          : field === "image_urls"
            ? "url_list"
            : "text";
  const common = {
    reviewed_revision: proposal.revision,
    reviewed_profile_version: version.id,
  };
  const edit = useMutation({
    mutationFn: () => {
      const rule = {
        kind,
        transform,
        [kind === "css" ? "selector" : "path"]: locator,
        ...(kind === "css" && attribute ? { attribute } : {}),
        ...(currency ? { currency_hint: currency } : {}),
      };
      return editSourceProfile(proposal.id, {
        ...common,
        rules: { ...(version.rules as Record<string, unknown>), [field]: rule },
      });
    },
    onSuccess: onUpdate,
  });
  const approve = useMutation({
    mutationFn: () => {
      if (!mode) throw new Error("روش بررسی نتایج را انتخاب کنید.");
      return approveSourceProfile(proposal.id, {
        ...common,
        confirmed,
        review_mode: mode,
        limitations_acknowledged: hasLimitations && limitationsAcknowledged,
        reason: hasLimitations ? reason.trim() : "",
      });
    },
    onSuccess: onUpdate,
  });
  const repair = useMutation({
    mutationFn: () =>
      repairSourceProfile(proposal.id, {
        ...common,
        request_id: requestId,
        selected_fields: selectedFields,
      }),
    retry: false,
    onSuccess: (updated) => {
      setRequestId(crypto.randomUUID());
      onUpdate(updated);
    },
  });
  const busy = edit.isPending || approve.isPending || repair.isPending;
  const pendingRepair = proposal.profile_repairs?.some(
    (attempt) => attempt.parent === version.id && attempt.outcome === "pending",
  );
  const selection: RepairSelection = {
    fields: selectedFields,
    disabled: busy || Boolean(pendingRepair),
    toggle: (name, checked) => {
      setSelectedFields((current) =>
        checked ? [...current, name] : current.filter((item) => item !== name),
      );
      setRequestId(crypto.randomUUID());
    },
  };
  const lastRepair = proposal.profile_repairs?.find(
    (attempt) => attempt.parent === version.id,
  );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="bg-card sticky top-36 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 shadow-sm lg:top-20">
        <p className="text-sm">
          {selectedFields.length.toLocaleString("fa-IR")} فیلد برای اصلاح انتخاب
          شده
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            aria-expanded={editorAction === "repair"}
            onClick={() =>
              setEditorAction(editorAction === "repair" ? "" : "repair")
            }
          >
            اصلاح هوشمند
          </Button>
          <Button
            aria-expanded={editorAction === "approve"}
            onClick={() =>
              setEditorAction(editorAction === "approve" ? "" : "approve")
            }
          >
            بررسی و فعال‌سازی
          </Button>
        </div>
      </div>
      {(repair.isPending || pendingRepair) && (
        <p role="status">
          در حال اصلاح قواعد؛ شواهد نسخه فعلی همچنان قابل بررسی است.
        </p>
      )}
      {lastRepair &&
        lastRepair.outcome !== "pending" &&
        lastRepair.outcome !== "succeeded" && (
          <p role="alert" className="rounded-xl border p-4 text-sm">
            {lastRepair.detail}
          </p>
        )}

      <div
        ref={editorAction === "repair" ? actionPanel : undefined}
        tabIndex={-1}
        className={
          editorAction === "repair"
            ? "grid scroll-mt-72 gap-4 lg:scroll-mt-40"
            : "hidden"
        }
      >
        <fieldset
          disabled={busy || pendingRepair}
          className="grid gap-3 rounded-md border p-3"
        >
          <legend className="px-1 font-medium">
            اصلاح هوشمند فیلدهای انتخاب‌شده
          </legend>
          <p className="text-sm">
            اصلاح، قواعد خواندن اطلاعات را تغییر می‌دهد؛ اطلاعات نمونه را ویرایش
            نمی‌کند. یک تا چهار فیلد را انتخاب کنید. فقط شواهد محدود و بدون
            شماره تماس برای مدل ارسال می‌شود. قواعد معتبر حتی با وجود خطای
            کیفیت، پیش‌نویس تازه‌ای می‌سازند که پیش از تأیید باید بررسی کنید.
          </p>
          <p className="text-sm">
            فیلدهای انتخاب‌شده:{" "}
            {selectedFields.map((name) => fields[name] ?? name).join("، ") ||
              "هنوز فیلدی انتخاب نشده است."}
          </p>
          <details open={version.samples.length === 0}>
            <summary>انتخاب از همه فیلدها</summary>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(fields).map(([name, label]) => (
                <label
                  key={name}
                  className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    aria-label={`اصلاح هوشمند ${label}`}
                    checked={selectedFields.includes(name)}
                    disabled={
                      selectedFields.length >= 4 &&
                      !selectedFields.includes(name)
                    }
                    onChange={(event) =>
                      selection.toggle(name, event.target.checked)
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
          <Button
            type="button"
            disabled={!selectedFields.length || busy || pendingRepair}
            onClick={() => repair.mutate()}
          >
            {repair.isPending ? "در حال اصلاح…" : "درخواست اصلاح هوشمند"}
          </Button>
        </fieldset>
        {repair.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(
                repair.error,
                "اصلاح انجام نشد؛ پرونده را تازه کنید.",
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
      <details className="rounded-xl border p-4">
        <summary>ابزارهای پیشرفته و اصلاح دستی</summary>
        <Button variant="outline" onClick={() => setEditorAction("edit")}>
          اصلاح دستی
        </Button>
        <div
          ref={editorAction === "edit" ? actionPanel : undefined}
          tabIndex={-1}
          className={
            editorAction === "edit"
              ? "grid scroll-mt-72 gap-4 lg:scroll-mt-40"
              : "hidden"
          }
        >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              edit.mutate();
            }}
          >
            <p>
              اصلاح یک فیلد، قواعد جایگزین همان فیلد را عوض می‌کند و نسخه
              تازه‌ای برای اعتبارسنجی می‌سازد.
            </p>
            <Label htmlFor={`field-${version.id}`}>فیلد مورد اصلاح</Label>
            <select
              id={`field-${version.id}`}
              className={selectClass}
              value={field}
              onChange={(event) => setField(event.target.value)}
            >
              {Object.entries(fields).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Label htmlFor={`kind-${version.id}`}>منبع مقدار</Label>
            <select
              id={`kind-${version.id}`}
              className={selectClass}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                setLocator("");
              }}
            >
              <option value="css">عنصر صفحه</option>
              <option value="json">داده ساخت‌یافته متصل</option>
            </select>
            <Label htmlFor={`locator-${version.id}`}>
              {kind === "css" ? "مسیر عنصر" : "مسیر داده"}
            </Label>
            <Input
              id={`locator-${version.id}`}
              dir="ltr"
              value={locator}
              maxLength={300}
              onChange={(event) => setLocator(event.target.value)}
              placeholder={kind === "css" ? ".area" : "$.floorSize.value"}
            />
            {kind === "css" && (
              <>
                <Label htmlFor={`attribute-${version.id}`}>
                  ویژگی عنصر (اختیاری)
                </Label>
                <Input
                  id={`attribute-${version.id}`}
                  dir="ltr"
                  value={attribute}
                  onChange={(event) => setAttribute(event.target.value)}
                  placeholder="content"
                />
              </>
            )}
            {transform === "money_rial" && (
              <>
                <Label htmlFor={`currency-${version.id}`}>واحد مبلغ</Label>
                <select
                  id={`currency-${version.id}`}
                  className={selectClass}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  <option value="">از متن</option>
                  <option value="تومان">تومان</option>
                  <option value="ریال">ریال</option>
                </select>
              </>
            )}
            <Button disabled={busy || !locator.trim()} type="submit">
              ثبت نسخه و اعتبارسنجی
            </Button>
          </form>
        </div>
      </details>
      <div
        ref={editorAction === "approve" ? actionPanel : undefined}
        tabIndex={-1}
        className={
          editorAction === "approve"
            ? "grid scroll-mt-72 gap-4 rounded-xl border p-5 lg:scroll-mt-40"
            : "hidden"
        }
      >
        <p className="text-muted-foreground text-sm">
          با تأیید این نسخه، قواعد استخراج فعال می‌شود و منبع به نماینده تخصیص
          می‌یابد. این تصمیم تأیید درستی همه مقادیر نمونه نیست. در حالت نیازمند
          تأیید اپراتور، آگهی‌ها پیش از انتشار بررسی می‌شوند؛ در حالت خودکار،
          نتایج تازه پس از عبور از کنترل‌های انتشار منتشر می‌شوند.
        </p>
        {hasLimitations && (
          <div className="bg-muted/30 rounded-lg p-3 text-sm">
            <p>
              شواهد بررسی:{" "}
              {version.validation.training_page_urls.length.toLocaleString(
                "fa-IR",
              )}{" "}
              صفحه ساخت قواعد و{" "}
              {version.validation.held_out_page_urls.length.toLocaleString(
                "fa-IR",
              )}{" "}
              صفحه اعتبارسنجی مستقل.
            </p>
            <p>
              فیلدهای نیازمند توجه:{" "}
              {Object.entries(version.validation.fields)
                .filter(([, report]) => report.passed === false)
                .map(([field]) => fields[field] ?? field)
                .join("، ") ||
                "محدودیت تعداد نمونه یا شواهد؛ گزارش این نسخه را بررسی کنید."}
            </p>
          </div>
        )}
        {version.validation.rules_valid === false && (
          <p role="status">
            قواعد از نظر فنی قابل اجرا نیستند؛ پیش از فعال‌سازی آن‌ها را اصلاح
            کنید.
          </p>
        )}
        {proposal.current_website_conflict && (
          <p role="status">ابتدا تعارض وب‌سایت را در نمای کلی برطرف کنید.</p>
        )}
        <Label htmlFor={`mode-${version.id}`}>روش بررسی نتایج</Label>
        <select
          id={`mode-${version.id}`}
          className={selectClass}
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="" disabled>
            روش بررسی را انتخاب کنید
          </option>
          <option value="approval_required">نیازمند تأیید اپراتور</option>
          <option value="automatic">انتشار خودکار نتایج معتبر</option>
        </select>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم.
        </label>
        {hasLimitations && (
          <fieldset
            className="grid gap-3 rounded-md border p-3"
            disabled={busy}
          >
            <legend>تأیید با وجود محدودیت‌های کیفیت</legend>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={limitationsAcknowledged}
                onChange={(event) =>
                  setLimitationsAcknowledged(event.target.checked)
                }
              />
              محدودیت‌های کیفیت را می‌پذیرم.
            </label>
            <Label htmlFor={`limitations-reason-${version.id}`}>
              دلیل تأیید با وجود محدودیت‌ها
            </Label>
            <Input
              id={`limitations-reason-${version.id}`}
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
          </fieldset>
        )}
        <Button
          disabled={
            busy ||
            proposal.current_website_conflict ||
            !mode ||
            !confirmed ||
            version.validation.rules_valid === false ||
            (hasLimitations && (!limitationsAcknowledged || !reason.trim()))
          }
          onClick={() => approve.mutate()}
        >
          تأیید پروفایل و تخصیص منبع
        </Button>
      </div>
      <ProfileEvidence version={version} selection={selection} />
      {(edit.error || approve.error) && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(edit.error ?? approve.error, "ثبت پروفایل ممکن نشد.")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ProfileHistory({ proposalId }: { proposalId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>تاریخچه نسخه‌های پروفایل</summary>
      {open && (
        <CaseRecords kind="profiles" proposalId={proposalId}>
          {(rows) => (
            <div className="grid gap-3">
              {rows.map((row) => (
                <PastProfile
                  key={row.id}
                  proposalId={proposalId}
                  versionId={row.id}
                  number={row.number}
                />
              ))}
            </div>
          )}
        </CaseRecords>
      )}
    </details>
  );
}
function PastProfile({
  proposalId,
  versionId,
  number,
}: {
  proposalId: string;
  versionId: string;
  number: number;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "operator-source-proposals",
      proposalId,
      "profile-version",
      versionId,
    ],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/source-proposals/{proposal_id}/profiles/{version_id}/",
        {
          params: { path: { proposal_id: proposalId, version_id: versionId } },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>نسخه {number.toLocaleString("fa-IR")}</summary>
      {open &&
        (query.data ? (
          <ProfileEvidence version={query.data} />
        ) : (
          <p role={query.isError ? "alert" : "status"}>
            {query.isError ? "بارگذاری ناموفق بود." : "در حال بارگذاری…"}
          </p>
        ))}
    </details>
  );
}
