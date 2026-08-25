import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <ul className="mb-5 grid gap-2 text-sm" aria-label="خلاصه حجم کار">
      <li>{format(summary.unclaimed_count)} کار بدون مسئول</li>
      <li>{format(summary.assigned_to_me_count)} کار واگذارشده به من</li>
      {"urgent_count" in summary ? (
        <li>{format(summary.urgent_count)} درخواست فوری</li>
      ) : null}
      <li>
        {format(summary.aging_count)} هشدار بیش از{" "}
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
    <PageMain>
      <header className="mb-8">
        <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          نمای کلی مسئولیت‌ها
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl leading-7">
          فقط بخش‌هایی که برای این حساب فعال شده‌اند در دسترس‌اند.
        </p>
      </header>

      <section
        className="grid gap-4 md:grid-cols-2"
        aria-label="بخش‌های در دسترس"
      >
        {availableModules.map(({ description, icon: Icon, label, to }) => {
          const query =
            to === "/operator/submissions" ? submissionSummary : supportSummary;
          return (
            <Card key={to} className="shadow-none">
              <CardHeader>
                <Icon className="text-primary size-7" aria-hidden="true" />
                <CardTitle className="mt-3">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4 leading-7">
                  {description}
                </p>
                <SummaryState
                  summary={query.data}
                  isPending={query.isPending}
                  isError={query.isError}
                />
                <Link
                  aria-label={label}
                  className="text-primary inline-flex min-h-11 items-center font-semibold"
                  to={to}
                >
                  ورود به بخش
                </Link>
              </CardContent>
            </Card>
          );
        })}
        <Card className="border-dashed shadow-none">
          <CardHeader>
            <Link2
              className="text-muted-foreground size-7"
              aria-hidden="true"
            />
            <CardTitle className="mt-3">بررسی پیوندها</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-5 leading-7">
              Link Verification برای آینده برنامه‌ریزی شده و هنوز گردش‌کار
              عملیاتی ندارد.
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
