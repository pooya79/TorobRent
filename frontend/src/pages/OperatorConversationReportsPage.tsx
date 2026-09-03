import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  conversationReportQueryOptions,
  conversationReportQueueQueryOptions,
  decideConversationReport,
  releaseConversationReportEvidence,
  type ConversationReportDecision,
} from "@/features/conversation-reports/queries";
import { errorMessage } from "@/lib/api/errors";

const statusLabels = {
  pending: "در انتظار بررسی",
  dismissed: "ردشده",
  upheld: "تأییدشده",
};

export function OperatorConversationReportsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [decision, setDecision] = useState<"dismissed" | "upheld">("dismissed");
  const [restrictPair, setRestrictPair] = useState(false);
  const [suspendAccountId, setSuspendAccountId] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const queue = useQuery(conversationReportQueueQueryOptions());
  const queueItems = queue.data?.results ?? [];
  const activeId = selectedId ?? queueItems[0]?.id ?? "";
  const detail = useQuery(conversationReportQueryOptions(activeId));
  const evidence = detail.data?.evidence;
  const decide = useMutation({
    mutationFn: (input: ConversationReportDecision) =>
      decideConversationReport(activeId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["operator-conversation-reports"],
      });
    },
  });
  const releaseEvidence = useMutation({
    mutationFn: () => releaseConversationReportEvidence(activeId, internalNote),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["operator-conversation-reports"],
      });
    },
  });

  const submitDecision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    decide.mutate({
      decision,
      internal_note: internalNote,
      restrict_pair: decision === "upheld" && restrictPair,
      suspend_account_id:
        decision === "upheld" && suspendAccountId ? suspendAccountId : null,
    });
  };

  return (
    <PageMain>
      <header className="mb-8">
        <p className="text-muted-foreground mb-2 text-sm">
          نظارت محدود به گزارش
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          صف گزارش‌های گفت‌وگو
        </h1>
        <p className="text-muted-foreground mt-3 max-w-3xl leading-7">
          فقط شواهد ثابت و مرتبط با گزارش انتخاب‌شده نمایش داده می‌شوند.
        </p>
      </header>

      {queue.isPending ? <p role="status">در حال دریافت گزارش‌ها…</p> : null}
      {queue.isError ? (
        <Alert variant="destructive">
          <AlertDescription>صف گزارش‌ها فعلاً در دسترس نیست.</AlertDescription>
        </Alert>
      ) : null}
      {!queue.isPending && !queue.isError && queueItems.length === 0 ? (
        <p>گزارشی برای بررسی وجود ندارد.</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <nav
          aria-label="گزارش‌های گفت‌وگو"
          className="grid content-start gap-2"
        >
          {queueItems.map((report) => (
            <Button
              key={report.id}
              type="button"
              variant={activeId === report.id ? "secondary" : "ghost"}
              className="h-auto justify-between py-3"
              onClick={() => setSelectedId(report.id)}
            >
              <span>
                {report.target === "message" ? "گزارش پیام" : "گزارش گفت‌وگو"}
              </span>
              <Badge variant="outline">
                {statusLabels[report.status ?? "pending"]}
              </Badge>
            </Button>
          ))}
        </nav>

        {detail.isPending && activeId ? (
          <p role="status">در حال دریافت شواهد…</p>
        ) : null}
        {detail.isError ? (
          <Alert variant="destructive">
            <AlertDescription>شواهد این گزارش در دسترس نیست.</AlertDescription>
          </Alert>
        ) : null}
        {detail.data ? (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>شرح گزارش</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p>
                  گزارش‌دهنده:{" "}
                  <strong>{detail.data.reporter.display_name}</strong>
                </p>
                <p>{detail.data.explanation || "بدون توضیح تکمیلی"}</p>
              </CardContent>
            </Card>

            {evidence ? (
              <section aria-labelledby="frozen-evidence-heading">
                <h2
                  id="frozen-evidence-heading"
                  className="mb-3 text-xl font-semibold"
                >
                  شواهد ثابت گزارش
                </h2>
                <ol className="grid gap-3">
                  {evidence.messages.map((message) => (
                    <li key={message.id}>
                      <Card
                        className={
                          evidence.target_message_id === message.id
                            ? "border-primary"
                            : undefined
                        }
                      >
                        <CardContent className="space-y-2 pt-6">
                          <strong>{message.author_display_name}</strong>
                          <p className="whitespace-pre-wrap">{message.body}</p>
                          <time
                            dateTime={message.created_at}
                            className="text-muted-foreground text-sm"
                          >
                            {new Date(message.created_at).toLocaleString(
                              "fa-IR",
                            )}
                          </time>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <p role="status">شواهد خصوصی این گزارش آزاد و حذف شده‌اند.</p>
            )}

            <section aria-labelledby="audit-heading">
              <h2 id="audit-heading" className="mb-3 text-xl font-semibold">
                تاریخچه ممیزی
              </h2>
              <ol
                aria-label="تاریخچه ممیزی بررسی"
                className="grid gap-2 text-sm"
              >
                {detail.data.audit_history.map((event) => (
                  <li key={event.id}>
                    {event.event_type} — {event.actor_label}
                  </li>
                ))}
              </ol>
            </section>

            {detail.data.status === "pending" && evidence ? (
              <Card>
                <CardHeader>
                  <CardTitle>تصمیم نظارتی</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-5" onSubmit={submitDecision}>
                    <div className="grid gap-2">
                      <Label htmlFor="report-decision">نتیجه بررسی</Label>
                      <select
                        id="report-decision"
                        className="border-input bg-background min-h-11 rounded-md border px-3"
                        value={decision}
                        onChange={(event) =>
                          setDecision(
                            event.target.value as "dismissed" | "upheld",
                          )
                        }
                      >
                        <option value="dismissed">رد گزارش</option>
                        <option value="upheld">تأیید گزارش</option>
                      </select>
                    </div>
                    <label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={restrictPair}
                        disabled={decision !== "upheld"}
                        onChange={(event) =>
                          setRestrictPair(event.target.checked)
                        }
                      />
                      قطع ارتباط این دو حساب
                    </label>
                    <div className="grid gap-2">
                      <Label htmlFor="suspended-account">
                        تعلیق شروع گفت‌وگوی تازه
                      </Label>
                      <select
                        id="suspended-account"
                        className="border-input bg-background min-h-11 rounded-md border px-3"
                        value={suspendAccountId}
                        disabled={decision !== "upheld"}
                        onChange={(event) =>
                          setSuspendAccountId(event.target.value)
                        }
                      >
                        <option value="">بدون تعلیق</option>
                        <option value={evidence.participants.renter_id}>
                          حساب Renter
                        </option>
                        <option value={evidence.participants.submitter_id}>
                          حساب Submitter
                        </option>
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="internal-note">یادداشت داخلی</Label>
                      <textarea
                        id="internal-note"
                        className="border-input min-h-28 rounded-md border p-3"
                        maxLength={2000}
                        value={internalNote}
                        onChange={(event) =>
                          setInternalNote(event.target.value)
                        }
                      />
                    </div>
                    {decide.error ? (
                      <p role="alert" className="text-destructive">
                        {errorMessage(decide.error, "ثبت تصمیم انجام نشد.")}
                      </p>
                    ) : null}
                    {decide.isSuccess ? (
                      <p role="status">تصمیم ثبت شد.</p>
                    ) : null}
                    <Button type="submit" disabled={decide.isPending}>
                      ثبت تصمیم
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
            {detail.data.status === "upheld" &&
            detail.data.evidence_retention_status === "required" ? (
              <Card>
                <CardHeader>
                  <CardTitle>نگهداری شواهد</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <p>شواهد این پرونده تحت نگهداری لازم قرار دارند.</p>
                  {releaseEvidence.error ? (
                    <p role="alert" className="text-destructive">
                      {errorMessage(
                        releaseEvidence.error,
                        "آزادسازی شواهد انجام نشد.",
                      )}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={releaseEvidence.isPending}
                    onClick={() => releaseEvidence.mutate()}
                  >
                    آزادسازی و حذف شواهد خصوصی
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </PageMain>
  );
}
