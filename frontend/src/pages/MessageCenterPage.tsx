import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, Mail, MailOpen } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  markMessageUnread,
  messageDetailQueryOptions,
  messagesQueryOptions,
  type MessageFilter,
} from "@/features/messages/queries";
import { cn } from "@/lib/utils";

const filters: { label: string; value: MessageFilter }[] = [
  { label: "همه", value: "all" },
  { label: "اعلان‌های سامانه", value: "system_notification" },
  { label: "خوانده‌نشده", value: "unread" },
];

function filterFrom(value: string | null): MessageFilter {
  return value === "system_notification" || value === "unread" ? value : "all";
}

function pageFrom(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
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
          اعلان‌های مهم حساب شما در اینجا نگهداری می‌شوند.
        </p>
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
              <ol className="divide-border divide-y">
                {feed.data.results.map((message) => (
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
                          <MailOpen className="size-4" aria-hidden="true" />
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
                              <span className="sr-only">خوانده‌نشده</span>
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                          {message.preview}
                        </span>
                        <time className="text-muted-foreground mt-2 block text-xs">
                          {new Date(message.created_at).toLocaleString("fa-IR")}
                        </time>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
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
                    <Bell aria-hidden="true" />
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
                  <p className="mt-6 leading-8">{detail.data.body}</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    {target ? (
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
    </main>
  );
}

export default MessageCenterPage;
