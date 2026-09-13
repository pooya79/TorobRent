import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Layers3, Link2 } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  WorkloadDashboard,
  type WorkloadQueue,
} from "@/features/operator/WorkloadDashboard";
import { operatorModules } from "@/features/operator/modules";
import { catalogCurationSummaryQuery } from "@/features/catalog-curation/queries";
import { currentUserQuery } from "@/features/session/queries";
import {
  submissionWorkloadSummaryQueryOptions,
  type SubmissionWorkloadSummary,
} from "@/features/submissions/queries";
import {
  supportWorkloadSummaryQueryOptions,
  type SupportWorkloadSummary,
} from "@/features/support/queries";

type WorkloadSummary = SubmissionWorkloadSummary | SupportWorkloadSummary;

function SummaryItems({ summary }: { summary: WorkloadSummary }) {
  const format = (value: number) => value.toLocaleString("fa-IR");
  return (
    <ul
      className="mb-5 grid grid-cols-2 gap-3 text-sm"
      aria-label="خلاصه حجم کار"
    >
      <li className="bg-muted/60 rounded-xl p-3">
        <span className="mb-1 block text-2xl font-semibold tabular-nums">
          {format(summary.unclaimed_count)}
        </span>
        <span className="text-muted-foreground">در انتظار مسئول</span>
      </li>
      <li className="bg-primary/5 rounded-xl p-3">
        <span className="text-primary mb-1 block text-2xl font-semibold tabular-nums">
          {format(summary.assigned_to_me_count)}
        </span>
        <span className="text-muted-foreground">واگذارشده به من</span>
      </li>
      {"urgent_count" in summary ? (
        <li className="text-destructive col-span-2">
          {format(summary.urgent_count)} درخواست فوری
        </li>
      ) : null}
      <li className="text-muted-foreground col-span-2 border-t pt-3">
        {format(summary.aging_count)} مورد با زمان انتظار بیش از{" "}
        {format(summary.aging_after_hours)} ساعت
      </li>
    </ul>
  );
}

function SummaryState({
  summary,
  isPending,
  isError,
}: {
  summary?: WorkloadSummary;
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) {
    return (
      <p className="text-muted-foreground mb-5 text-sm" role="status">
        در حال دریافت خلاصه حجم کار…
      </p>
    );
  }
  if (isError || !summary) {
    return (
      <p className="text-destructive mb-5 text-sm" role="alert">
        خلاصه این بخش فعلاً در دسترس نیست.
      </p>
    );
  }
  return <SummaryItems summary={summary} />;
}

export function OperatorOverviewPage() {
  const currentUser = useQuery(currentUserQuery);
  const capabilities = currentUser.data?.operator_capabilities ?? [];
  const availableModules = operatorModules.filter(
    ({ capabilities: required }) =>
      required.some((capability) => capabilities.includes(capability)),
  );
  const mayReviewSubmissions = capabilities.includes("review_submissions");
  const mayCurateCatalog = capabilities.includes("curate_catalog");
  const mayHandleSupport = capabilities.some(
    (capability) =>
      capability === "handle_support" ||
      capability === "handle_privacy_requests",
  );
  const submissionSummary = useQuery(
    submissionWorkloadSummaryQueryOptions(mayReviewSubmissions),
  );
  const supportSummary = useQuery(
    supportWorkloadSummaryQueryOptions(mayHandleSupport),
  );
  const catalogSummary = useQuery(
    catalogCurationSummaryQuery(mayCurateCatalog),
  );

  const queues: WorkloadQueue[] = [
    ...(mayReviewSubmissions
      ? [
          {
            label: "درخواست‌های ثبت آگهی",
            to: "/operator/submissions",
            data: submissionSummary.data,
            isPending: submissionSummary.isPending,
            isError: submissionSummary.isError,
          },
        ]
      : []),
    ...(mayHandleSupport
      ? [
          {
            label: "پشتیبانی",
            to: "/operator/support",
            data: supportSummary.data,
            isPending: supportSummary.isPending,
            isError: supportSummary.isError,
          },
        ]
      : []),
  ];

  return (
    <PageMain className="max-w-7xl">
      <header className="relative mb-6 overflow-hidden rounded-3xl bg-[#163e35] p-6 text-white sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-16 size-80 rounded-full border-[40px] border-white/5"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 left-24 size-80 rounded-full border border-white/10"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="mb-4 flex items-center gap-2 text-sm text-emerald-100">
              <Layers3 className="size-4" aria-hidden="true" />
              میز کار اپراتور
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              نمای کلی کارها
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-emerald-50/80">
              تصویر روشن‌تری از کارها داشته باشید؛ اولویت‌ها را ببینید و رسیدگی
              بعدی را شروع کنید.
            </p>
          </div>
          {queues.length > 0 && (
            <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-emerald-100">
              <Activity className="size-3.5" aria-hidden="true" />
              به‌روزرسانی خودکار هر ۳۰ ثانیه
            </span>
          )}
        </div>
      </header>

      <WorkloadDashboard queues={queues} />

      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">بخش‌های کاری</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            مسیر مستقیم به صف‌های در دسترس شما
          </p>
        </div>
        <span className="text-muted-foreground shrink-0 text-xs">
          {availableModules.length.toLocaleString("fa-IR")} بخش
        </span>
      </div>

      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="بخش‌های در دسترس"
      >
        {availableModules.map(({ description, icon: Icon, label, to }) => {
          const query =
            to === "/operator/submissions" ? submissionSummary : supportSummary;
          const hasSummary =
            to === "/operator/submissions" || to === "/operator/support";
          return (
            <Card
              key={to}
              className="hover:border-info/40 gap-4 rounded-2xl shadow-none transition-colors"
            >
              <CardHeader className="flex-row items-center gap-3">
                <span className="bg-info-soft text-info flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-lg">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-muted-foreground mb-4 leading-7">
                  {description}
                </p>
                {to === "/operator/catalog-curation" ? (
                  catalogSummary.isPending ? (
                    <p
                      className="text-muted-foreground mb-5 text-sm"
                      role="status"
                    >
                      در حال دریافت شمار کارها…
                    </p>
                  ) : catalogSummary.data ? (
                    <p className="text-muted-foreground mb-5 text-sm">
                      <strong className="text-foreground text-2xl tabular-nums">
                        {catalogSummary.data.total_count.toLocaleString(
                          "fa-IR",
                        )}
                      </strong>{" "}
                      مورد نیازمند رسیدگی
                    </p>
                  ) : (
                    <p className="text-destructive mb-5 text-sm" role="alert">
                      شمار این صف فعلاً در دسترس نیست.
                    </p>
                  )
                ) : hasSummary ? (
                  <SummaryState
                    summary={query.data}
                    isPending={query.isPending}
                    isError={query.isError}
                  />
                ) : (
                  <p className="text-muted-foreground mb-5 text-sm">
                    موارد در انتظار را از صف اختصاصی این بخش بررسی کنید.
                  </p>
                )}
                <Button
                  asChild
                  variant="outline"
                  className="mt-auto w-full justify-between"
                >
                  <Link aria-label={label} to={to}>
                    {label}
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
        <Card className="bg-muted/30 gap-3 rounded-2xl border-dashed shadow-none">
          <CardHeader>
            <Link2
              className="text-muted-foreground size-7"
              aria-hidden="true"
            />
            <CardTitle className="mt-3 text-base">
              بررسی پیوندها · به‌زودی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-5 leading-7">
              بررسی پیوندها برای آینده برنامه‌ریزی شده و هنوز گردش‌کار عملیاتی
              ندارد.
            </p>
            <Link
              className="text-primary inline-flex min-h-11 items-center font-semibold"
              to="/operator/links"
            >
              درباره این بخش
            </Link>
          </CardContent>
        </Card>
      </section>
    </PageMain>
  );
}

export default OperatorOverviewPage;
