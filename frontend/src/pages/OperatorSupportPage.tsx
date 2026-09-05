import { SupportQueueFilterPanel } from "@/features/support/SupportQueueFilters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Headphones, Send, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { currentUserQuery } from "@/features/session/queries";
import {
  supportClassificationLabels,
  supportResolutionLabels,
} from "@/features/support/labels";
import { SupportResolutionPanel } from "@/features/support/SupportResolutionPanel";
import { SupportTriagePanel } from "@/features/support/SupportTriagePanel";
import {
  addSupportNote,
  claimSupportRequest,
  editSupportReply,
  postSupportReply,
  reassignSupportRequest,
  recordSupportExternalContact,
  recordSupportIdentityVerification,
  recordSupportPrivacyAction,
  releaseSupportRequest,
  reopenSupportRequest,
  resolveSupportRequest,
  supportQueueQueryOptions,
  supportRequestQueryOptions,
  triageSupportRequest,
  type SupportQueueFilters,
  type IntakeKind,
  type SupportReassignmentInput,
  type SupportExternalContactInput,
  type SupportIdentityVerificationInput,
  type SupportNoteInput,
  type SupportPrivacyActionInput,
  type SupportReopenInput,
  type SupportResolutionInput,
  type SupportRequestQueueItem,
  type SupportRequestStatus,
  type SupportTriageInput,
} from "@/features/support/queries";
import { errorMessage } from "@/lib/api/errors";

const statusLabels = {
  open: "باز",
  in_progress: "در حال رسیدگی",
  escalated: "ارجاع‌شده",
  resolved: "رسیدگی‌شده",
} satisfies Record<SupportRequestStatus, string>;

const intakeKindLabels = {
  general: "راهنمایی و پرسش",
  account_deletion: "حذف حساب",
  public_contact_removal: "حذف اطلاعات تماس عمومی",
} satisfies Record<IntakeKind, string>;

const priorityLabels = {
  normal: "عادی",
  urgent: "فوری",
} as const;

const eventLabels = {
  assigned: "واگذاری",
  classified: "تغییر دسته‌بندی",
  escalated: "ارجاع تخصصی",
  priority_changed: "تغییر فوریت",
  reassigned: "واگذاری مجدد",
  released: "آزادسازی",
  note_added: "یادداشت داخلی",
  external_contact_recorded: "ثبت ارتباط بیرونی",
  resolved: "نتیجه نهایی",
  reopened: "بازگشایی",
  identity_verified: "تأیید هویت",
  privacy_action_recorded: "ثبت اقدام حریم خصوصی",
  personal_content_redacted: "حذف محتوای شخصی",
} as const;

function requestTitle(supportRequest: SupportRequestQueueItem) {
  return supportRequest.name || supportRequest.email;
}

function assignmentAge(assignedAt: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(assignedAt).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes.toLocaleString("fa-IR")} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toLocaleString("fa-IR")} ساعت`;
  return `${Math.floor(hours / 24).toLocaleString("fa-IR")} روز`;
}

export function OperatorSupportPage() {
  const queryClient = useQueryClient();
  const currentUser = useQuery(currentUserQuery);
  const [filters, setFilters] = useState<SupportQueueFilters>({
    ordering: "oldest",
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [editingReplyId, setEditingReplyId] = useState<string>();
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const queue = useQuery(supportQueueQueryOptions(filters));
  const queueItems = (queue.data?.results ?? []).filter(
    ({ id }) => !suppressedIds.has(id),
  );
  const activeId =
    selectedId && !suppressedIds.has(selectedId)
      ? selectedId
      : (queueItems[0]?.id ?? "");
  const detail = useQuery(supportRequestQueryOptions(activeId));
  const selected = detail.data;
  const threadReplies = (selected?.replies ?? []).filter(
    (reply) => !reply.is_initial,
  );

  const refreshSupportRequest = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["operator-support-requests"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["operator-support-requests", "detail", activeId],
      }),
    ]);
  };
  const claim = useMutation({
    mutationFn: () => claimSupportRequest(activeId),
    onSuccess: refreshSupportRequest,
  });
  const release = useMutation({
    mutationFn: () => releaseSupportRequest(activeId),
    onSuccess: refreshSupportRequest,
  });
  const triage = useMutation({
    mutationFn: (input: SupportTriageInput) =>
      triageSupportRequest(activeId, input),
    onSuccess: async (_, input) => {
      const losesPrivacyAccess =
        (input.classification === "privacy" ||
          input.classification === "account_deletion") &&
        !currentUser.data?.operator_capabilities.includes(
          "handle_privacy_requests",
        );
      const lacksRequiredCapability = Boolean(
        input.required_capability &&
        !currentUser.data?.operator_capabilities.includes(
          input.required_capability,
        ),
      );
      if (losesPrivacyAccess || lacksRequiredCapability) {
        setSuppressedIds((current) => new Set(current).add(activeId));
        setSelectedId(undefined);
        queryClient.removeQueries({
          queryKey: ["operator-support-requests", "detail", activeId],
        });
      }
      await refreshSupportRequest();
    },
  });
  const reassign = useMutation({
    mutationFn: (input: SupportReassignmentInput) =>
      reassignSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const addNote = useMutation({
    mutationFn: (input: SupportNoteInput) => addSupportNote(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const postReply = useMutation({
    mutationFn: (body: string) => postSupportReply(activeId, body),
    onSuccess: refreshSupportRequest,
  });
  const editReply = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      editSupportReply(activeId, id, body),
    onSuccess: async () => {
      setEditingReplyId(undefined);
      await refreshSupportRequest();
    },
  });
  const recordExternalContact = useMutation({
    mutationFn: (input: SupportExternalContactInput) =>
      recordSupportExternalContact(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const resolve = useMutation({
    mutationFn: (input: SupportResolutionInput) =>
      resolveSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const reopen = useMutation({
    mutationFn: (input: SupportReopenInput) =>
      reopenSupportRequest(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const recordIdentityVerification = useMutation({
    mutationFn: (input: SupportIdentityVerificationInput) =>
      recordSupportIdentityVerification(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const recordPrivacyAction = useMutation({
    mutationFn: (input: SupportPrivacyActionInput) =>
      recordSupportPrivacyAction(activeId, input),
    onSuccess: refreshSupportRequest,
  });
  const mutationError =
    claim.error ??
    release.error ??
    triage.error ??
    reassign.error ??
    addNote.error ??
    postReply.error ??
    editReply.error ??
    recordExternalContact.error ??
    resolve.error ??
    reopen.error ??
    recordIdentityVerification.error ??
    recordPrivacyAction.error;
  const operationalMutationPending =
    addNote.isPending ||
    postReply.isPending ||
    editReply.isPending ||
    recordExternalContact.isPending ||
    resolve.isPending ||
    reopen.isPending ||
    recordIdentityVerification.isPending ||
    recordPrivacyAction.isPending;

  return (
    <PageMain>
      <header className="mb-6 border-b pb-6">
        <p className="text-muted-foreground mb-2 text-sm">فضای اپراتور</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          صف درخواست‌های پشتیبانی
        </h1>
        <p className="text-muted-foreground mt-2">
          {queue.isPending
            ? "در حال دریافت درخواست‌ها…"
            : queue.data
              ? `${queue.data.count.toLocaleString("fa-IR")} مورد مطابق فیلترها`
              : "دریافت درخواست‌ها ناموفق بود"}
        </p>
      </header>

      <SupportQueueFilterPanel filters={filters} onApply={setFilters} />
      {queue.isError && (
        <Alert className="mb-5" variant="destructive">
          <AlertDescription>
            دریافت درخواست‌ها ممکن نشد. اتصال و فیلترهای انتخابی را بررسی کنید.
            <Button
              type="button"
              variant="outline"
              className="ms-3"
              onClick={() => void queue.refetch()}
            >
              تلاش دوباره
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {mutationError && (
        <Alert className="mb-5" variant="destructive">
          <AlertDescription>
            {errorMessage(
              mutationError,
              "تغییر مسئول درخواست پشتیبانی ناموفق بود.",
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="space-y-3" aria-label="صف درخواست‌های پشتیبانی">
          {queueItems.map((supportRequest) => (
            <button
              className={`border-border focus-visible:ring-ring min-h-24 w-full rounded-2xl border p-4 text-start transition-colors focus-visible:ring-2 focus-visible:outline-none ${supportRequest.id === selected?.id ? "border-primary bg-primary/5 ring-primary/20 ring-1" : "bg-card hover:bg-muted/60"}`}
              aria-pressed={supportRequest.id === selected?.id}
              key={supportRequest.id}
              onClick={() => {
                setSelectedId(supportRequest.id);
                setEditingReplyId(undefined);
              }}
              type="button"
            >
              <span className="mb-2 flex items-center justify-between gap-2 font-semibold">
                {requestTitle(supportRequest)}
                <Badge>
                  {statusLabels[supportRequest.status ?? "open"] ??
                    supportRequest.status}
                </Badge>
              </span>
              <span className="text-muted-foreground block text-xs">
                {intakeKindLabels[supportRequest.intake_kind]}
              </span>
              {supportRequest.priority === "urgent" && (
                <Badge className="mt-2" variant="destructive">
                  فوری
                </Badge>
              )}
              <span className="mt-2 flex items-center gap-2 text-xs">
                <UserRound className="size-3" aria-hidden="true" />
                {supportRequest.assignee_email ?? "بدون مسئول"}
              </span>
              {supportRequest.assigned_at && (
                <span className="text-muted-foreground mt-1 block text-xs">
                  سن واگذاری: {assignmentAge(supportRequest.assigned_at)}
                </span>
              )}
            </button>
          ))}
          {!queue.isPending && !queue.isError && queueItems.length === 0 && (
            <p className="text-muted-foreground">موردی در صف نیست.</p>
          )}
          <div className="flex justify-between gap-3">
            <Button
              variant="outline"
              disabled={!queue.data?.previous}
              onClick={() =>
                setFilters({
                  ...filters,
                  page: Math.max(1, (filters.page ?? 1) - 1),
                })
              }
            >
              صفحه قبل
            </Button>
            <Button
              variant="outline"
              disabled={!queue.data?.next}
              onClick={() =>
                setFilters({ ...filters, page: (filters.page ?? 1) + 1 })
              }
            >
              صفحه بعد
            </Button>
          </div>
        </section>

        {selected ? (
          <Card key={selected.id} className="rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle>{requestTitle(selected)}</CardTitle>
              <p className="text-muted-foreground text-sm">{selected.email}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="bg-muted rounded-lg p-4">
                  <dt>نوع درخواست اولیه</dt>
                  <dd className="mt-1 font-semibold">
                    {intakeKindLabels[selected.intake_kind]}
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>دسته‌بندی درخواست</dt>
                  <dd className="mt-1 font-semibold">
                    {supportClassificationLabels[
                      selected.classification ?? "unclassified"
                    ] ?? selected.classification}
                  </dd>
                </div>
                <div className="bg-muted rounded-lg p-4">
                  <dt>اولویت</dt>
                  <dd className="mt-1 font-semibold">
                    {priorityLabels[selected.priority ?? "normal"]}
                  </dd>
                </div>
                {(selected.escalation_destination ||
                  selected.required_capability) && (
                  <div className="bg-muted rounded-lg p-4">
                    <dt>مسیر تخصصی</dt>
                    <dd className="mt-1 font-semibold">
                      {selected.escalation_destination ||
                        (selected.required_capability ===
                        "handle_privacy_requests"
                          ? "پشتیبانی حریم خصوصی"
                          : "پشتیبانی عمومی")}
                    </dd>
                  </div>
                )}
                <div className="bg-muted rounded-lg p-4 sm:col-span-2">
                  <dt>متن درخواست</dt>
                  <dd className="mt-1 font-semibold whitespace-pre-wrap">
                    {selected.message}
                  </dd>
                </div>
                {selected.assigned_at && (
                  <div className="bg-muted rounded-lg p-4 sm:col-span-2">
                    <dt>زمان واگذاری</dt>
                    <dd className="mt-1 flex flex-wrap items-center gap-2 font-semibold">
                      <Clock3 className="size-4" aria-hidden="true" />
                      <time
                        aria-label="زمان واگذاری ثبت‌شده"
                        dateTime={selected.assigned_at}
                      >
                        {new Date(selected.assigned_at).toLocaleString("fa-IR")}
                      </time>
                      <span className="text-muted-foreground font-normal">
                        ({assignmentAge(selected.assigned_at)} پیش)
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {(selected.status === "open" ||
                selected.status === "escalated") && (
                <div className="bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <p className="text-muted-foreground text-sm">
                    برای شروع رسیدگی، مسئولیت این درخواست را بپذیرید.
                  </p>
                  <Button
                    disabled={claim.isPending}
                    onClick={() => claim.mutate()}
                  >
                    <Headphones className="size-4" aria-hidden="true" />
                    {claim.isPending ? "در حال پذیرش…" : "پذیرفتن درخواست"}
                  </Button>
                </div>
              )}
              {selected.status === "in_progress" &&
                selected.assignee_id === currentUser.data?.id && (
                  <section
                    className="rounded-xl border p-4"
                    aria-labelledby="support-reply-title"
                  >
                    <h2 id="support-reply-title" className="font-semibold">
                      پاسخ قابل مشاهده برای درخواست‌کننده
                    </h2>
                    {threadReplies.length > 0 ? (
                      <ol className="mt-3 space-y-2">
                        {threadReplies.map((reply) => (
                          <li
                            className="bg-muted rounded-lg p-3 text-sm"
                            key={reply.id}
                          >
                            <p className="mb-2 text-xs font-semibold">
                              {reply.author_kind === "operator"
                                ? "پاسخ اپراتور"
                                : "پیام درخواست‌کننده"}
                            </p>
                            {editingReplyId === reply.id ? (
                              <form
                                className="grid gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const body = new FormData(
                                    event.currentTarget,
                                  ).get("edited_reply");
                                  if (typeof body === "string" && body.trim()) {
                                    editReply.mutate({ id: reply.id, body });
                                  }
                                }}
                              >
                                <Label htmlFor={`operator-edit-${reply.id}`}>
                                  ویرایش پاسخ
                                </Label>
                                <textarea
                                  className="border-input min-h-24 rounded-md border p-3"
                                  defaultValue={reply.body}
                                  id={`operator-edit-${reply.id}`}
                                  maxLength={2000}
                                  name="edited_reply"
                                  required
                                />
                                <Button
                                  className="justify-self-start"
                                  disabled={editReply.isPending}
                                  size="sm"
                                  type="submit"
                                >
                                  ذخیره ویرایش
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="justify-self-start"
                                  disabled={editReply.isPending}
                                  onClick={() => setEditingReplyId(undefined)}
                                >
                                  انصراف از ویرایش
                                </Button>
                              </form>
                            ) : (
                              <p className="whitespace-pre-wrap">
                                {reply.body}
                              </p>
                            )}
                            {reply.edited_at ? (
                              <span className="text-muted-foreground text-xs">
                                ویرایش‌شده
                              </span>
                            ) : null}
                            {reply.editable && editingReplyId !== reply.id ? (
                              <Button
                                className="mt-2"
                                onClick={() => setEditingReplyId(reply.id)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                ویرایش
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <form
                      className="mt-4 grid gap-3"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const body = new FormData(form).get("support_reply");
                        if (typeof body === "string" && body.trim()) {
                          postReply.mutate(body, {
                            onSuccess: () => form.reset(),
                          });
                        }
                      }}
                    >
                      <Label htmlFor="operator-support-reply">
                        پاسخ پشتیبانی
                      </Label>
                      <textarea
                        className="border-input bg-background focus-visible:ring-ring min-h-32 rounded-xl border p-3 leading-7 focus-visible:ring-2 focus-visible:outline-none"
                        id="operator-support-reply"
                        name="support_reply"
                        required
                        maxLength={2000}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                        <Button
                          className="rounded-xl"
                          disabled={postReply.isPending}
                          type="submit"
                        >
                          <Send className="size-4" aria-hidden="true" />
                          {postReply.isPending ? "در حال ارسال…" : "ارسال پاسخ"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="rounded-xl"
                          disabled={release.isPending}
                          onClick={() => release.mutate()}
                          type="button"
                        >
                          آزاد کردن درخواست
                        </Button>
                      </div>
                    </form>
                  </section>
                )}

              <SupportTriagePanel
                key={`triage-${selected.id}`}
                canManageQueue={Boolean(
                  currentUser.data?.operator_capabilities.includes(
                    "manage_operator_queues",
                  ),
                )}
                isPending={triage.isPending || reassign.isPending}
                onReassign={(input) => reassign.mutate(input)}
                onTriage={(input) => triage.mutate(input)}
                supportRequest={selected}
              />

              <SupportResolutionPanel
                key={`resolution-${selected.id}`}
                isAssignee={selected.assignee_id === currentUser.data?.id}
                isPending={operationalMutationPending}
                onAddNote={(input) => addNote.mutate(input)}
                onRecordExternalContact={(input) =>
                  recordExternalContact.mutate(input)
                }
                onRecordIdentityVerification={(input) =>
                  recordIdentityVerification.mutate(input)
                }
                onRecordPrivacyAction={(input) =>
                  recordPrivacyAction.mutate(input)
                }
                onReopen={(input) => reopen.mutate(input)}
                onResolve={(input) => resolve.mutate(input)}
                supportRequest={selected}
              />

              <section aria-labelledby="support-history-title">
                <h2 id="support-history-title" className="font-semibold">
                  تاریخچه عملیاتی
                </h2>
                <ol className="mt-3 space-y-3">
                  {(selected.history ?? []).map((event) => (
                    <li
                      className="border-border rounded-lg border p-3 text-sm"
                      key={event.id}
                    >
                      <p className="font-medium">
                        {eventLabels[event.event_type]}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {event.actor_label} · {statusLabels[event.prior_state]}{" "}
                        ← {statusLabels[event.new_state]}
                      </p>
                      <time
                        aria-label="زمان رویداد"
                        className="text-muted-foreground mt-1 block text-xs"
                        dateTime={event.created_at}
                      >
                        {new Date(event.created_at).toLocaleString("fa-IR")}
                      </time>
                      {event.reason && <p className="mt-1">{event.reason}</p>}
                      {event.resolution_category && (
                        <p className="mt-1">
                          {supportResolutionLabels[event.resolution_category]}
                        </p>
                      )}
                      {event.resolution_summary && (
                        <p className="mt-1 whitespace-pre-wrap">
                          {event.resolution_summary}
                        </p>
                      )}
                    </li>
                  ))}
                  {(selected.history ?? []).length === 0 && (
                    <li className="text-muted-foreground text-sm">
                      هنوز رویدادی ثبت نشده است.
                    </li>
                  )}
                </ol>
              </section>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl shadow-none">
            <CardContent className="text-muted-foreground py-10 text-center">
              یک درخواست پشتیبانی را برای مشاهده جزئیات انتخاب کنید.
            </CardContent>
          </Card>
        )}
      </div>
    </PageMain>
  );
}
