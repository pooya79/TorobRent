import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  Headphones,
  Mail,
  MailOpen,
  MessageCircle,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";

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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  blockListingInquiryCounterpart,
  markMessageUnread,
  editListingInquiryMessage,
  editSupportMessage,
  messageDetailQueryOptions,
  messagesQueryOptions,
  replyToSupportRequest,
  replyToListingInquiry,
  reportListingInquiry,
  type MessageFilter,
  type MessageSummary,
} from "@/features/messages/queries";
import { cn } from "@/lib/utils";

const filters: { label: string; value: MessageFilter }[] = [
  { label: "همه", value: "all" },
  { label: "اعلان‌های سامانه", value: "system_notification" },
  { label: "پرسش‌های آگهی", value: "listing_inquiry" },
  { label: "پشتیبانی", value: "support_request" },
  { label: "خوانده‌نشده", value: "unread" },
];

function filterFrom(value: string | null): MessageFilter {
  return value === "system_notification" ||
    value === "listing_inquiry" ||
    value === "support_request" ||
    value === "unread"
    ? value
    : "all";
}

function pageFrom(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function groupLabel(group: MessageSummary["group"]) {
  if (group.kind === "support_request") return group.label;
  if (group.kind === "listing_inquiry") return `آگهی ${group.label}`;
  return group.kind === "source_proposal"
    ? `منبع پیشنهادی ${group.label}`
    : group.label;
}

const statusLabels = {
  received: "دریافت شد",
  in_progress: "در حال بررسی",
  resolved: "رسیدگی شد",
} as const;

const OFF_PLATFORM_WARNING_KEY =
  "listing-inquiry-off-platform-warning-acknowledged";

function phoneHref(text: string) {
  if (!/^(?:\+?98|0|۰)(?:[\s-]?[0-9۰-۹]){9,12}$/u.test(text)) return;
  const latinDigits = text.replace(/[۰-۹]/gu, (digit) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)),
  );
  return `tel:${latinDigits.replace(/[\s-]/gu, "")}`;
}

function safeText(
  text: string,
  onExternalLink?: (href: string) => void,
): ReactNode[] {
  return text
    .split(/(https?:\/\/[^\s]+|(?:\+?98|0|۰)(?:[\s-]?[0-9۰-۹]){9,12})/gu)
    .map((part, index) => {
      const href = /^https?:\/\//u.test(part) ? part : phoneHref(part);
      return href ? (
        <a
          className="text-primary underline"
          href={href}
          key={`${part}-${index}`}
          onClick={
            onExternalLink
              ? (event) => {
                  event.preventDefault();
                  onExternalLink(href);
                }
              : undefined
          }
          rel="noopener noreferrer"
          target={href.startsWith("http") ? "_blank" : undefined}
        >
          {part}
        </a>
      ) : (
        part
      );
    });
}

function toman(rial: number) {
  return (rial / 10).toLocaleString("fa-IR");
}

function groupMessages(messages: MessageSummary[]) {
  const groups: { key: string; messages: MessageSummary[] }[] = [];
  for (const [index, message] of messages.entries()) {
    const groupKey = `${message.group.kind}:${message.group.id}`;
    const previous = groups.at(-1);
    if (previous?.key.startsWith(`${groupKey}:`)) {
      previous.messages.push(message);
    } else {
      groups.push({ key: `${groupKey}:${index}`, messages: [message] });
    }
  }
  return groups;
}

export function MessageCenterPage() {
  const { messageId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = filterFrom(searchParams.get("filter"));
  const page = pageFrom(searchParams.get("page"));
  const feed = useQuery(messagesQueryOptions(filter, page));
  const detail = useQuery(messageDetailQueryOptions(messageId));
  const queryClient = useQueryClient();
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [editingId, setEditingId] = useState<string>();
  const [pendingExternalHref, setPendingExternalHref] = useState<string>();
  const [blockConfirmationOpen, setBlockConfirmationOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<string | null>();
  const [reportExplanation, setReportExplanation] = useState("");
  const markUnread = useMutation({
    mutationFn: () => {
      if (!messageId) throw new Error("Message id is required");
      return markMessageUnread(messageId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["messages", "detail", messageId], updated);
      void queryClient.invalidateQueries({ queryKey: ["messages", "feed"] });
      void queryClient.invalidateQueries({
        queryKey: ["messages", "unread-count"],
      });
    },
  });
  const reply = useMutation({
    mutationFn: (body: string) => {
      if (!messageId) throw new Error("Message id is required");
      if (detail.data?.kind === "listing_inquiry") {
        return replyToListingInquiry(messageId, body);
      }
      return replyToSupportRequest(messageId, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  const editMessage = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => {
      if (!messageId) throw new Error("Message id is required");
      if (detail.data?.kind === "listing_inquiry") {
        return editListingInquiryMessage(messageId, id, body);
      }
      return editSupportMessage(messageId, id, body);
    },
    onSuccess: () => {
      setEditingId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  const blockCounterpart = useMutation({
    mutationFn: () => {
      if (!messageId) throw new Error("Message id is required");
      return blockListingInquiryCounterpart(messageId);
    },
    onSuccess: () => {
      setBlockConfirmationOpen(false);
      queryClient.setQueryData(
        ["messages", "detail", messageId],
        detail.data
          ? {
              ...detail.data,
              reply_allowed: false,
              reply_unavailable_reason: "account_blocked" as const,
            }
          : detail.data,
      );
      void queryClient.invalidateQueries({ queryKey: ["catalog", "property"] });
      void queryClient.invalidateQueries({
        queryKey: ["catalog", "properties"],
      });
    },
  });
  const reportConversation = useMutation({
    mutationFn: () => {
      if (!messageId) throw new Error("Message id is required");
      return reportListingInquiry(
        messageId,
        reportTarget ?? null,
        reportExplanation.trim(),
      );
    },
    onSuccess: () => {
      setReportTarget(undefined);
      setReportExplanation("");
      void queryClient.invalidateQueries({
        queryKey: ["messages", "detail", messageId],
      });
    },
  });

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = data.get("body");
    if (typeof body !== "string" || !body.trim()) return;
    reply.mutate(body, { onSuccess: () => form.reset() });
  }

  useEffect(() => {
    if (!detail.data) return;
    detailHeading.current?.focus();
    void queryClient.invalidateQueries({ queryKey: ["messages", "feed"] });
    void queryClient.invalidateQueries({
      queryKey: ["messages", "unread-count"],
    });
  }, [detail.data, queryClient]);

  const target = detail.data?.target ?? undefined;

  function goToPage(nextPage: number) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextPage <= 1) nextParams.delete("page");
    else nextParams.set("page", String(nextPage));
    setSearchParams(nextParams);
  }

  function requestExternalNavigation(href: string) {
    const participantKey = `${OFF_PLATFORM_WARNING_KEY}:${messageId}:${detail.data?.counterpart?.role}`;
    if (localStorage.getItem(participantKey) === "true") {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    setPendingExternalHref(href);
  }

  function continueExternalNavigation() {
    if (!pendingExternalHref) return;
    const participantKey = `${OFF_PLATFORM_WARNING_KEY}:${messageId}:${detail.data?.counterpart?.role}`;
    localStorage.setItem(participantKey, "true");
    window.open(pendingExternalHref, "_blank", "noopener,noreferrer");
    setPendingExternalHref(undefined);
  }

  return (
    <main
      id="main-content"
      dir="rtl"
      className="mx-auto w-full max-w-432 px-4 py-8 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <header className="mb-6">
        <p className="text-primary mb-2 text-sm font-semibold">حساب کاربری</p>
        <h1 className="text-3xl font-semibold tracking-tight">مرکز پیام</h1>
        <p className="text-muted-foreground mt-2">
          پرسش‌های آگهی، اعلان‌ها و گفت‌وگوهای پشتیبانی حساب شما در اینجا
          نگهداری می‌شوند.
        </p>
        <Button asChild className="mt-4">
          <Link to="/messages/new/support">درخواست پشتیبانی جدید</Link>
        </Button>
      </header>

      <nav aria-label="فیلتر پیام‌ها" className="mb-4 flex flex-wrap gap-2">
        {filters.map((item) => (
          <Button
            key={item.value}
            aria-pressed={filter === item.value}
            onClick={() => {
              setSearchParams(
                item.value === "all" ? {} : { filter: item.value },
              );
            }}
            type="button"
            variant={filter === item.value ? "default" : "outline"}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="grid min-h-112 overflow-hidden rounded-xl border md:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.6fr)]">
        <section
          aria-label="فهرست پیام‌ها"
          className={cn(
            "border-border border-e",
            messageId && "hidden md:block",
          )}
          role="region"
        >
          {feed.isPending ? (
            <p className="text-muted-foreground p-5" role="status">
              در حال بارگذاری پیام‌ها…
            </p>
          ) : feed.isError ? (
            <Alert className="m-4" variant="destructive">
              <AlertDescription>
                بارگذاری پیام‌ها انجام نشد. دوباره تلاش کنید.
              </AlertDescription>
            </Alert>
          ) : feed.data.results.length === 0 ? (
            <p className="text-muted-foreground p-5">
              {filter === "unread"
                ? "پیام خوانده‌نشده‌ای ندارید."
                : "هنوز پیامی ندارید."}
            </p>
          ) : (
            <>
              <div className="divide-border divide-y">
                {groupMessages(feed.data.results).map(({ key, messages }) => {
                  const group = messages[0]?.group;
                  if (!group) return null;
                  const label = groupLabel(group);
                  return (
                    <section aria-label={label} key={key} role="group">
                      <h2 className="bg-muted/40 text-muted-foreground px-4 py-2 text-xs font-semibold">
                        {label}
                      </h2>
                      <ol className="divide-border divide-y">
                        {messages.map((message) => (
                          <li key={message.id}>
                            <Link
                              aria-current={
                                message.id === messageId ? "page" : undefined
                              }
                              className={cn(
                                "hover:bg-muted/60 flex min-h-28 gap-3 p-4 transition-colors",
                                message.id === messageId && "bg-muted",
                              )}
                              to={`/messages/${message.id}${searchParams.size ? `?${searchParams}` : ""}`}
                            >
                              <span className="bg-primary/10 text-primary mt-1 flex size-9 shrink-0 items-center justify-center rounded-full">
                                {message.read ? (
                                  <MailOpen
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Mail className="size-4" aria-hidden="true" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                  <span
                                    className={cn(
                                      "font-medium",
                                      !message.read && "font-bold",
                                    )}
                                  >
                                    {message.title}
                                  </span>
                                  {!message.read ? (
                                    <span className="bg-primary mt-2 size-2 shrink-0 rounded-full">
                                      <span className="sr-only">
                                        خوانده‌نشده
                                      </span>
                                    </span>
                                  ) : null}
                                </span>
                                <span className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                                  {message.preview}
                                </span>
                                <time className="text-muted-foreground mt-2 block text-xs">
                                  {new Date(message.created_at).toLocaleString(
                                    "fa-IR",
                                  )}
                                </time>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </section>
                  );
                })}
              </div>
              {feed.data.previous || feed.data.next ? (
                <nav
                  aria-label="صفحه‌بندی پیام‌ها"
                  className="flex justify-between gap-3 p-4"
                >
                  <Button
                    disabled={!feed.data.previous}
                    onClick={() => goToPage(page - 1)}
                    type="button"
                    variant="outline"
                  >
                    صفحه قبل
                  </Button>
                  <Button
                    disabled={!feed.data.next}
                    onClick={() => goToPage(page + 1)}
                    type="button"
                    variant="outline"
                  >
                    صفحه بعد
                  </Button>
                </nav>
              ) : null}
            </>
          )}
        </section>

        <section
          aria-label="جزئیات پیام"
          className={cn("p-5 sm:p-7", !messageId && "hidden md:block")}
          role="region"
        >
          {messageId ? (
            <>
              <Link
                className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold md:hidden"
                to={`/messages${searchParams.size ? `?${searchParams}` : ""}`}
              >
                <ArrowRight aria-hidden="true" /> بازگشت به پیام‌ها
              </Link>
              {detail.isPending ? (
                <p role="status">در حال بارگذاری پیام…</p>
              ) : detail.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    این پیام در دسترس نیست یا اجازه مشاهده آن را ندارید.
                  </AlertDescription>
                </Alert>
              ) : detail.data ? (
                <article>
                  <div className="text-primary bg-primary/10 mb-4 flex size-11 items-center justify-center rounded-full">
                    {detail.data.kind === "support_request" ? (
                      <Headphones aria-hidden="true" />
                    ) : detail.data.kind === "listing_inquiry" ? (
                      <MessageCircle aria-hidden="true" />
                    ) : (
                      <Bell aria-hidden="true" />
                    )}
                  </div>
                  <h2
                    ref={detailHeading}
                    className="text-2xl font-semibold outline-none"
                    tabIndex={-1}
                  >
                    {detail.data.title}
                  </h2>
                  <time className="text-muted-foreground mt-2 block text-sm">
                    {new Date(detail.data.created_at).toLocaleString("fa-IR")}
                  </time>
                  {detail.data.kind === "support_request" ? (
                    <>
                      <p className="text-muted-foreground mt-3 text-sm">
                        وضعیت:{" "}
                        {
                          statusLabels[
                            detail.data
                              .public_status as keyof typeof statusLabels
                          ]
                        }
                      </p>
                      <ol aria-label="رشته پشتیبانی" className="mt-6 space-y-3">
                        {detail.data.entries.map((entry) => (
                          <li
                            className={cn(
                              "rounded-lg border p-4",
                              entry.kind === "operator_reply" && "bg-primary/5",
                              entry.kind === "status" && "bg-muted text-sm",
                            )}
                            key={`${entry.kind}-${entry.id}`}
                          >
                            {entry.kind === "status" ? (
                              <p>{statusLabels[entry.status!]}</p>
                            ) : (
                              <>
                                <p className="mb-2 text-xs font-semibold">
                                  {entry.kind === "operator_reply"
                                    ? "پاسخ اپراتور"
                                    : "شما"}
                                </p>
                                {editingId === entry.id ? (
                                  <form
                                    className="grid gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      const body = new FormData(
                                        event.currentTarget,
                                      ).get("edited_body");
                                      if (
                                        typeof body === "string" &&
                                        body.trim()
                                      ) {
                                        editMessage.mutate({
                                          id: entry.id,
                                          body,
                                        });
                                      }
                                    }}
                                  >
                                    <Label htmlFor={`edit-${entry.id}`}>
                                      ویرایش پیام
                                    </Label>
                                    <textarea
                                      className="border-input min-h-24 rounded-md border p-3"
                                      defaultValue={entry.body}
                                      id={`edit-${entry.id}`}
                                      maxLength={2000}
                                      name="edited_body"
                                      required
                                    />
                                    <Button
                                      className="justify-self-start"
                                      size="sm"
                                      type="submit"
                                    >
                                      ذخیره ویرایش
                                    </Button>
                                  </form>
                                ) : (
                                  <p className="leading-7 whitespace-pre-wrap">
                                    {safeText(entry.body ?? "")}
                                  </p>
                                )}
                                {entry.edited_at ? (
                                  <span className="text-muted-foreground mt-2 block text-xs">
                                    ویرایش‌شده
                                  </span>
                                ) : null}
                                {entry.editable && editingId !== entry.id ? (
                                  <Button
                                    className="mt-2"
                                    onClick={() => setEditingId(entry.id)}
                                    size="sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    ویرایش
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </li>
                        ))}
                      </ol>
                      {detail.data.reply_allowed ? (
                        <form
                          className="mt-6 grid gap-3"
                          onSubmit={submitReply}
                        >
                          <Label htmlFor="support-reply">ادامه گفت‌وگو</Label>
                          <textarea
                            className="border-input min-h-28 rounded-md border p-3"
                            id="support-reply"
                            name="body"
                            required
                            maxLength={2000}
                          />
                          <Button
                            className="justify-self-start"
                            disabled={reply.isPending}
                            type="submit"
                          >
                            {reply.isPending ? "در حال ارسال…" : "ارسال پیام"}
                          </Button>
                        </form>
                      ) : (
                        <Alert className="mt-6">
                          <AlertDescription>
                            <p>مهلت ادامه این درخواست پایان یافته است.</p>
                            <Button asChild className="mt-3" size="sm">
                              <Link to="/messages/new/support">
                                ایجاد درخواست پشتیبانی جدید
                              </Link>
                            </Button>
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  ) : detail.data.kind === "listing_inquiry" ? (
                    <>
                      <p className="mt-3 font-semibold">
                        گفت‌وگو با {detail.data.counterpart?.display_name}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        نام نمایشی؛ هویت تأییدشده نیست
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {detail.data.reply_unavailable_reason !==
                        "account_blocked" ? (
                          <Button
                            onClick={() => setBlockConfirmationOpen(true)}
                            type="button"
                            variant="outline"
                          >
                            مسدود کردن حساب
                          </Button>
                        ) : null}
                        <Button
                          onClick={() => setReportTarget(null)}
                          type="button"
                          variant="outline"
                        >
                          گزارش گفت‌وگو
                        </Button>
                      </div>
                      {detail.data.listing_context ? (
                        <section
                          aria-label="اطلاعات آگهی"
                          className="bg-muted/40 mt-5 rounded-lg border p-4"
                        >
                          <h3 className="font-semibold">
                            اطلاعات هنگام شروع گفت‌وگو
                          </h3>
                          <p className="mt-2">
                            {
                              detail.data.listing_context.opening_snapshot
                                .property_title
                            }
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {detail.data.listing_context.opening_snapshot.area_sqm.toLocaleString(
                              "fa-IR",
                            )}{" "}
                            متر مربع
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            ودیعه:{" "}
                            {toman(
                              detail.data.listing_context.opening_snapshot
                                .rental_terms.deposit_rial,
                            )}{" "}
                            تومان · اجاره ماهانه:{" "}
                            {toman(
                              detail.data.listing_context.opening_snapshot
                                .rental_terms.monthly_rent_rial,
                            )}{" "}
                            تومان
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            منبع:{" "}
                            {
                              detail.data.listing_context.opening_snapshot
                                .source_display_name
                            }
                          </p>
                          <p className="mt-3 text-sm font-semibold">
                            وضعیت فعلی:{" "}
                            {detail.data.listing_context.current_availability
                              .is_active
                              ? "فعال"
                              : "غیرفعال"}
                          </p>
                        </section>
                      ) : null}
                      <ol
                        aria-label="رشته پرسش آگهی"
                        className="mt-6 space-y-3"
                      >
                        {detail.data.entries.map((entry) => (
                          <li
                            className={cn(
                              "rounded-lg border p-4",
                              entry.mine ? "bg-primary/5 ms-6" : "me-6",
                            )}
                            key={entry.id}
                          >
                            <p className="mb-2 text-xs font-semibold">
                              {entry.author_name}
                            </p>
                            {editingId === entry.id ? (
                              <form
                                className="grid gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const body = new FormData(
                                    event.currentTarget,
                                  ).get("edited_body");
                                  if (typeof body === "string" && body.trim()) {
                                    editMessage.mutate({ id: entry.id, body });
                                  }
                                }}
                              >
                                <Label htmlFor={`edit-inquiry-${entry.id}`}>
                                  ویرایش پیام
                                </Label>
                                <textarea
                                  className="border-input min-h-24 rounded-md border p-3"
                                  defaultValue={entry.body}
                                  id={`edit-inquiry-${entry.id}`}
                                  maxLength={2000}
                                  name="edited_body"
                                  required
                                />
                                <Button
                                  className="justify-self-start"
                                  size="sm"
                                  type="submit"
                                >
                                  ذخیره ویرایش
                                </Button>
                              </form>
                            ) : (
                              <p className="leading-7 whitespace-pre-wrap">
                                {safeText(
                                  entry.body ?? "",
                                  requestExternalNavigation,
                                )}
                              </p>
                            )}
                            {entry.edited_at ? (
                              <span className="text-muted-foreground mt-2 block text-xs">
                                ویرایش‌شده
                              </span>
                            ) : null}
                            {entry.editable && editingId !== entry.id ? (
                              <Button
                                className="mt-2"
                                onClick={() => setEditingId(entry.id)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                ویرایش
                              </Button>
                            ) : null}
                            <Button
                              className="mt-2"
                              onClick={() => setReportTarget(entry.id)}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              گزارش پیام
                            </Button>
                          </li>
                        ))}
                      </ol>
                      {detail.data.reply_allowed ? (
                        <form
                          className="mt-6 grid gap-3"
                          onSubmit={submitReply}
                        >
                          <Label htmlFor="listing-inquiry-reply">
                            ادامه گفت‌وگو
                          </Label>
                          <textarea
                            className="border-input min-h-28 rounded-md border p-3"
                            id="listing-inquiry-reply"
                            maxLength={2000}
                            name="body"
                            required
                          />
                          <Button
                            className="justify-self-start"
                            disabled={reply.isPending}
                            type="submit"
                          >
                            {reply.isPending ? "در حال ارسال…" : "ارسال پیام"}
                          </Button>
                          {reply.isError ? (
                            <p
                              className="text-destructive text-sm"
                              role="alert"
                            >
                              ارسال پیام انجام نشد.
                            </p>
                          ) : null}
                        </form>
                      ) : (
                        <Alert className="mt-6">
                          <AlertDescription>
                            {detail.data.reply_unavailable_reason ===
                            "account_blocked"
                              ? "ارتباط میان شما و این حساب مسدود شده است."
                              : detail.data.reply_unavailable_reason ===
                                  "responsibility_changed"
                                ? "مسئول آگهی تغییر کرده و این گفت‌وگو برای شرکت‌کنندگان اصلی فقط خواندنی است."
                                : "این آگهی فعال نیست و گفت‌وگو فعلا فقط خواندنی است."}
                          </AlertDescription>
                        </Alert>
                      )}
                    </>
                  ) : (
                    <p className="mt-6 leading-8">{detail.data.body}</p>
                  )}
                  <div className="mt-8 flex flex-wrap gap-3">
                    {detail.data.kind === "support_request" ? null : target ? (
                      <Button asChild>
                        <Link to={target.href}>{target.label}</Link>
                      </Button>
                    ) : (
                      <Button aria-disabled="true" disabled type="button">
                        مقصد دیگر در دسترس نیست
                      </Button>
                    )}
                    <Button
                      disabled={markUnread.isPending}
                      onClick={() => markUnread.mutate()}
                      type="button"
                      variant="outline"
                    >
                      علامت‌گذاری به‌عنوان خوانده‌نشده
                    </Button>
                  </div>
                  {markUnread.isError ? (
                    <p className="text-destructive mt-4" role="alert">
                      تغییر وضعیت پیام انجام نشد.
                    </p>
                  ) : null}
                </article>
              ) : null}
            </>
          ) : (
            <Card className="hidden h-full place-items-center border-0 shadow-none md:grid">
              <CardContent className="text-muted-foreground text-center">
                <MailOpen className="mx-auto mb-3 size-8" aria-hidden="true" />
                <p>برای مشاهده جزئیات، یک پیام را انتخاب کنید.</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
      <AlertDialog
        onOpenChange={setBlockConfirmationOpen}
        open={blockConfirmationOpen}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>مسدود کردن این حساب؟</AlertDialogTitle>
            <AlertDialogDescription>
              این مسدودسازی برای همه آگهی‌ها اعمال می‌شود و ارسال پیام و نمایش
              شماره تماس تازه را در هر دو جهت متوقف می‌کند. تاریخچه فعلی باقی
              می‌ماند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              disabled={blockCounterpart.isPending}
              onClick={() => blockCounterpart.mutate()}
            >
              تأیید مسدودسازی
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(pendingExternalHref)}
        onOpenChange={(open) => !open && setPendingExternalHref(undefined)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>ادامه گفت‌وگو خارج از ترب‌رنت</AlertDialogTitle>
            <AlertDialogDescription>
              پیش از دنبال‌کردن پیوند یا تماس با شماره، هویت طرف مقابل و خطرهای
              ارتباط خارج از سامانه را بررسی کنید. ترب‌رنت پیش‌نمایش پیوند نمایش
              نمی‌دهد و مسئول محتوای مقصد نیست.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel>ماندن در ترب‌رنت</AlertDialogCancel>
            <AlertDialogAction onClick={continueExternalNavigation}>
              متوجه شدم؛ ادامه به پیوند
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={reportTarget !== undefined}
        onOpenChange={(open) => !open && setReportTarget(undefined)}
      >
        <AlertDialogContent dir="rtl">
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              reportConversation.mutate();
            }}
          >
            <AlertDialogHeader className="text-right sm:text-right">
              <AlertDialogTitle>
                {reportTarget ? "گزارش این پیام" : "گزارش کل گفت‌وگو"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                محتوای مرتبط برای بررسی ثابت می‌شود. جزئیات هویت اپراتور و
                یادداشت‌های داخلی نمایش داده نخواهد شد.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="conversation-report-explanation">
                توضیح اختیاری
              </Label>
              <textarea
                id="conversation-report-explanation"
                className="border-input min-h-28 rounded-md border p-3"
                maxLength={2000}
                value={reportExplanation}
                onChange={(event) => setReportExplanation(event.target.value)}
              />
            </div>
            {reportConversation.isError ? (
              <p className="text-destructive" role="alert">
                ثبت گزارش انجام نشد.
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel type="button">انصراف</AlertDialogCancel>
              <Button disabled={reportConversation.isPending} type="submit">
                ثبت گزارش
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default MessageCenterPage;
