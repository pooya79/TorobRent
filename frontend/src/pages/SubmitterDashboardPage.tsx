import { SourceAssignmentSummary } from "@/features/source-proposals/SourceAssignmentSummary";
import { discoveryStageLabels } from "@/features/source-proposals/discovery-labels";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Globe2, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  removeSourceProposalDraft,
  type SourceProposal,
  sourceProposalsQueryOptions,
} from "@/features/source-proposals/queries";
import {
  archiveListing,
  confirmListingAvailability,
  markListingUnavailable,
  removeSubmissionDraft,
  type Submission,
  submissionsQueryOptions,
} from "@/features/submissions/queries";
import {
  notificationAlertVariant,
  notificationStatusLabel,
} from "@/features/submissions/notification";
import {
  submissionStateLabels,
  submissionStepLabel,
} from "@/features/submissions/steps";
import { errorMessage } from "@/lib/api/errors";

const sourceProposalStateLabels = {
  draft: "پیش‌نویس",
  pending: "در انتظار بررسی",
  changes_requested: "نیازمند اصلاح",
  rejected: "ردشده",
  approved: "تأییدشده",
};

export function SubmitterDashboardPage() {
  const submissions = useQuery(submissionsQueryOptions);
  const sourceProposals = useQuery(sourceProposalsQueryOptions);
  const queryClient = useQueryClient();
  const draftRemoval = useMutation({
    mutationFn: (target: {
      kind: "submission" | "source_proposal";
      id: string;
    }) =>
      target.kind === "submission"
        ? removeSubmissionDraft(target.id)
        : removeSourceProposalDraft(target.id),
    onSuccess: (_data, target) => {
      if (target.kind === "submission") {
        queryClient.setQueryData<Submission[]>(["submissions"], (current) =>
          current?.filter((submission) => submission.id !== target.id),
        );
        return;
      }
      queryClient.setQueryData<SourceProposal[]>(
        ["source-proposals"],
        (current) => current?.filter((proposal) => proposal.id !== target.id),
      );
    },
  });
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
          <h1 className="text-3xl font-semibold tracking-tight">
            پیشنهادهای من
          </h1>
          <p className="text-muted-foreground mt-2">
            وضعیت Property Submissionها و Source Proposalها را جداگانه دنبال
            کنید.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link to="/submitter/get-started">
            <Plus aria-hidden="true" /> پیشنهاد تازه
          </Link>
        </Button>
      </header>

      {draftRemoval.isError && (
        <Alert className="mb-6" variant="destructive">
          <AlertDescription>
            {errorMessage(
              draftRemoval.error,
              "حذف پیش‌نویس انجام نشد. دوباره تلاش کنید.",
            )}
          </AlertDescription>
        </Alert>
      )}

      <section className="mb-10" aria-labelledby="source-proposals-heading">
        <div className="mb-4">
          <h2 id="source-proposals-heading" className="text-xl font-semibold">
            پیشنهادهای منبع
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            وب‌سایت‌هایی که برای اعتبارسنجی اپراتور معرفی کرده‌اید.
          </p>
        </div>
        {sourceProposals.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Source Proposalها بارگذاری نشدند.
            </AlertDescription>
          </Alert>
        )}
        {sourceProposals.isPending && <p>در حال بارگذاری پیشنهادهای منبع…</p>}
        {sourceProposals.data?.length === 0 && (
          <Card className="shadow-none">
            <CardContent>
              <p>هنوز وب‌سایتی معرفی نکرده‌اید.</p>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4">
          {sourceProposals.data?.map((proposal) => {
            const title = proposal.website_name || "Source Proposal تازه";
            const state = proposal.state ?? "draft";
            const sourceState = sourceProposalStateLabels[state];
            const history = proposal.history ?? [];
            const canEdit = proposal.available_actions.includes("edit");
            const canDelete = proposal.available_actions.includes("delete");
            return (
              <Card className="shadow-none" key={proposal.id}>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  {state !== "approved" && state !== "rejected" && (
                    <p role="status">
                      {
                        discoveryStageLabels[
                          proposal.discovery_stage ?? "awaiting_url"
                        ]
                      }
                    </p>
                  )}
                  <span className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-full">
                    <Globe2 className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-semibold">{title}</h3>
                      <Badge variant="secondary">{sourceState}</Badge>
                      <span className="text-muted-foreground text-xs">
                        نسخه {(proposal.revision ?? 1).toLocaleString("fa-IR")}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {state === "pending"
                        ? "اقدام بعدی: منتظر بررسی اپراتور بمانید."
                        : state === "changes_requested"
                          ? "اقدام بعدی: موارد خواسته‌شده را اصلاح و دوباره ارسال کنید."
                          : state === "approved"
                            ? "بررسی این پیشنهاد پایان یافته است."
                            : state === "rejected"
                              ? "این پیشنهاد بسته شده است."
                              : "اقدام بعدی: اطلاعات و پیش‌نمایش را تکمیل و تأیید کنید."}
                    </p>
                    {proposal.assignment && (
                      <SourceAssignmentSummary
                        assignment={proposal.assignment}
                      />
                    )}
                    {history.length > 0 && (
                      <section
                        className="mt-4 rounded-lg border p-3"
                        aria-label={`تاریخچه Source Proposal ${title}`}
                      >
                        <h4 className="font-medium">تاریخچه بررسی</h4>
                        <ol className="mt-2 grid gap-3 text-sm">
                          {history.map((event) => (
                            <li key={event.id}>
                              <p>
                                {sourceProposalStateLabels[event.new_state]} —
                                نسخه {event.revision.toLocaleString("fa-IR")}
                              </p>
                              {event.reason && (
                                <p className="mt-1">{event.reason}</p>
                              )}
                              <p className="text-muted-foreground mt-1 text-xs">
                                {new Date(event.created_at).toLocaleString(
                                  "fa-IR",
                                )}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button asChild variant="outline">
                        <Link
                          to={`/source-proposal?proposal=${proposal.id}`}
                          aria-label={`${state === "changes_requested" ? "اصلاح" : "ادامه"} Source Proposal ${title}`}
                        >
                          {state === "changes_requested" ? "اصلاح" : "ادامه"}{" "}
                          <ArrowLeft aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                    {canDelete && (
                      <DeleteDraftDialog
                        label={title}
                        pending={draftRemoval.isPending}
                        onDelete={() =>
                          draftRemoval.mutate({
                            kind: "source_proposal",
                            id: proposal.id,
                          })
                        }
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <h2 className="mb-4 text-xl font-semibold">Property Submissionها</h2>

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
          const canDelete =
            submission.available_actions?.includes("delete") ?? false;
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
            <Card
              className="shadow-none"
              id={`submission-${submission.id}`}
              key={submission.id}
            >
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
                    {canDelete && (
                      <DeleteDraftDialog
                        label={title}
                        pending={draftRemoval.isPending}
                        onDelete={() =>
                          draftRemoval.mutate({
                            kind: "submission",
                            id: submission.id,
                          })
                        }
                      />
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
                {submission.notification && (
                  <Alert
                    variant={notificationAlertVariant(
                      submission.notification.status,
                    )}
                  >
                    <AlertDescription>
                      {notificationStatusLabel(submission.notification.status)}
                      {submission.notification.status === "failed" &&
                        " تصمیم و جزئیات آن همچنان در همین داشبورد معتبر است."}
                    </AlertDescription>
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

function DeleteDraftDialog({
  label,
  pending,
  onDelete,
}: {
  label: string;
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          aria-label={`حذف پیش‌نویس ${label}`}
          disabled={pending}
          type="button"
          variant="outline"
        >
          <Trash2 aria-hidden="true" /> حذف
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>پیش‌نویس حذف شود؟</AlertDialogTitle>
          <AlertDialogDescription>
            پیش‌نویس «{label}» برای همیشه حذف می‌شود و قابل بازیابی نیست.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={pending}
            onClick={onDelete}
          >
            حذف پیش‌نویس
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default SubmitterDashboardPage;
