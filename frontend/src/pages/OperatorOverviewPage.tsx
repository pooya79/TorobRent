import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Link2 } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { operatorModules } from "@/features/operator/modules";
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

  return (
    <PageMain className="max-w-7xl">
      <header className="mb-8 border-b pb-6">
        <p className="text-primary mb-2 text-sm font-medium">میز کار اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          نمای کلی کارها
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl leading-7">
          کارهای در انتظار را ببینید و برای شروع رسیدگی، بخش مورد نظر را انتخاب
          کنید.
        </p>
      </header>

      <section
        className="grid gap-4 md:grid-cols-2"
        aria-label="بخش‌های در دسترس"
      >
        {availableModules.map(({ description, icon: Icon, label, to }) => {
          const query =
            to === "/operator/submissions" ? submissionSummary : supportSummary;
          const hasSummary =
            to === "/operator/submissions" || to === "/operator/support";
          return (
            <Card key={to} className="gap-4 rounded-2xl shadow-none">
              <CardHeader className="flex-row items-center gap-3">
                <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-lg">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <p className="text-muted-foreground mb-4 leading-7">
                  {description}
                </p>
                {hasSummary ? (
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
        <Card className="bg-muted/30 gap-3 border-dashed shadow-none md:col-span-2">
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
