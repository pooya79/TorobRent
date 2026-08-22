import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Plus } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { submissionsQueryOptions } from "@/features/submissions/queries";
import { submissionStepLabel } from "@/features/submissions/steps";

export function SubmitterDashboardPage() {
  const submissions = useQuery(submissionsQueryOptions);

  return (
    <PageMain>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">پنل ثبت‌کننده</p>
          <h1 className="text-3xl font-semibold tracking-tight">آگهی‌های من</h1>
          <p className="text-muted-foreground mt-2">
            وضعیت Submissionها و اقدام بعدی را یک‌جا دنبال کنید.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link to="/add-submission">
            <Plus aria-hidden="true" /> ثبت آگهی تازه
          </Link>
        </Button>
      </header>

      {submissions.isError && (
        <Alert variant="destructive">
          <AlertDescription>پیش‌نویس‌ها بارگذاری نشدند.</AlertDescription>
        </Alert>
      )}
      {submissions.isPending && <p>در حال بارگذاری پیش‌نویس‌ها…</p>}
      {submissions.data?.length === 0 && (
        <Card className="shadow-none">
          <CardContent>
            <p>هنوز Submissionی ندارید. نخستین پیش‌نویس را بسازید.</p>
          </CardContent>
        </Card>
      )}
      <section className="grid gap-4" aria-label="ارسال‌های شما">
        {submissions.data?.map((submission) => {
          const title = submission.location?.neighborhood
            ? `ملک در ${submission.location.neighborhood}`
            : submission.role === "owner"
              ? "پیش‌نویس مالک"
              : "پیش‌نویس نماینده مالک";
          const currentStep = submission.current_step ?? "location";
          return (
            <Card className="shadow-none" key={submission.id}>
              <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full">
                  <Clock3 className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <h2 className="font-semibold">{title}</h2>
                    <Badge variant="secondary">پیش‌نویس</Badge>
                  </div>
                  <p className="text-sm">
                    مرحله کنونی: {submissionStepLabel(currentStep)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    آخرین ذخیره:{" "}
                    {new Date(submission.updated_at).toLocaleString("fa-IR")}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link
                    to={`/add-submission?submission=${submission.id}&step=${currentStep}`}
                    aria-label={`ادامه ${title}`}
                  >
                    ادامه <ArrowLeft aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </PageMain>
  );
}

export default SubmitterDashboardPage;
