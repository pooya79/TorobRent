import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Plus } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  archiveListing,
  confirmListingAvailability,
  markListingUnavailable,
  type Submission,
  submissionsQueryOptions,
} from "@/features/submissions/queries";
import {
  submissionStateLabels,
  submissionStepLabel,
} from "@/features/submissions/steps";
import { errorMessage } from "@/lib/api/errors";

export function SubmitterDashboardPage() {
  const submissions = useQuery(submissionsQueryOptions);
  const queryClient = useQueryClient();
  const availabilityAction = useMutation({
    mutationFn: ({
      submissionId,
      action,
    }: {
      submissionId: string;
      action: "confirm" | "unavailable" | "archive";
    }) => {
      if (action === "confirm") return confirmListingAvailability(submissionId);
      if (action === "unavailable") return markListingUnavailable(submissionId);
      return archiveListing(submissionId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Submission[]>(["submissions"], (current) =>
        current?.map((submission) =>
          submission.id === updated.id ? updated : submission,
        ),
      );
    },
  });

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
          const canEdit =
            submission.available_actions?.includes("edit") ??
            submission.state === "draft";
          const canSubmit =
            submission.available_actions?.includes("submit") ?? false;
          const canConfirmAvailability =
            submission.available_actions?.includes("confirm_availability") ??
            false;
          const canMarkUnavailable =
            submission.available_actions?.includes("mark_unavailable") ?? false;
          const canArchive =
            submission.available_actions?.includes("archive") ?? false;
          const latestReason = [...(submission.history ?? [])]
            .reverse()
            .find((event) => event.reason)?.reason;
          return (
            <Card className="shadow-none" key={submission.id}>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full">
                    <Clock3 className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h2 className="font-semibold">{title}</h2>
                      <Badge variant="secondary">
                        {submissionStateLabels[submission.state ?? "draft"]}
                      </Badge>
                      {submission.revision && (
                        <span className="text-muted-foreground text-xs">
                          نسخه {submission.revision.toLocaleString("fa-IR")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">
                      مرحله کنونی: {submissionStepLabel(currentStep)}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      آخرین ذخیره:{" "}
                      {new Date(submission.updated_at).toLocaleString("fa-IR")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button asChild variant="outline">
                        <Link
                          to={`/add-submission?submission=${submission.id}&step=${currentStep}`}
                          aria-label={`${submission.state === "changes_requested" ? "اصلاح" : "ادامه"} ${title}`}
                        >
                          {submission.state === "changes_requested"
                            ? "اصلاح"
                            : "ادامه"}{" "}
                          <ArrowLeft aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                    {canSubmit && (
                      <Button asChild>
                        <Link
                          to={`/add-submission?submission=${submission.id}&step=review`}
                          aria-label={`ارسال برای بررسی ${title}`}
                        >
                          ارسال برای بررسی
                          <ArrowLeft aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                    {canConfirmAvailability && (
                      <Button
                        type="button"
                        onClick={() =>
                          availabilityAction.mutate({
                            submissionId: submission.id,
                            action: "confirm",
                          })
                        }
                        disabled={availabilityAction.isPending}
                      >
                        تأیید موجودی
                      </Button>
                    )}
                    {canMarkUnavailable && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          availabilityAction.mutate({
                            submissionId: submission.id,
                            action: "unavailable",
                          })
                        }
                        disabled={availabilityAction.isPending}
                      >
                        ناموجود شده
                      </Button>
                    )}
                    {canArchive && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          availabilityAction.mutate({
                            submissionId: submission.id,
                            action: "archive",
                          })
                        }
                        disabled={availabilityAction.isPending}
                      >
                        بایگانی
                      </Button>
                    )}
                  </div>
                </div>
                {submission.availability?.expiring_soon && (
                  <Alert>
                    <AlertDescription>
                      این آگهی در هفت روز آینده منقضی می‌شود. اگر همچنان موجود
                      است، موجودی را تأیید کنید.
                    </AlertDescription>
                  </Alert>
                )}
                {availabilityAction.isSuccess &&
                  availabilityAction.data.id === submission.id &&
                  availabilityAction.variables.action === "confirm" && (
                    <Alert>
                      <AlertDescription>
                        موجودی آگهی برای ۳۰ روز دیگر تأیید شد.
                      </AlertDescription>
                    </Alert>
                  )}
                {availabilityAction.isError &&
                  availabilityAction.variables?.submissionId ===
                    submission.id && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {errorMessage(
                          availabilityAction.error,
                          "تغییر وضعیت موجودی انجام نشد.",
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                {latestReason && (
                  <Alert>
                    <AlertDescription>{latestReason}</AlertDescription>
                  </Alert>
                )}
                {submission.history && submission.history.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium">
                      تاریخچه وضعیت
                    </summary>
                    <ol className="mt-3 space-y-2 border-s ps-4">
                      {submission.history.map((event) => (
                        <li key={event.id}>
                          {submissionStateLabels[event.prior_state]} ←{" "}
                          {submissionStateLabels[event.new_state]}
                          <span className="text-muted-foreground ms-2">
                            {new Date(event.created_at).toLocaleString("fa-IR")}
                          </span>
                          {event.reason && (
                            <p className="mt-1">{event.reason}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </PageMain>
  );
}

export default SubmitterDashboardPage;
