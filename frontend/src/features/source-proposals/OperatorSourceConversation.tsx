import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { MessageTextForm } from "@/features/messages/MessageTextForm";
import {
  messageDetailQueryOptions,
  replyToSourceConversation,
} from "@/features/messages/queries";
import { cn } from "@/lib/utils";

export function OperatorSourceConversation({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    ...messageDetailQueryOptions(conversationId),
    refetchInterval: 15_000,
  });
  const reply = useMutation({
    mutationFn: (body: string) =>
      replyToSourceConversation(conversationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });
  useEffect(() => {
    if (!detail.data) return;
    void queryClient.invalidateQueries({ queryKey: ["messages", "feed"] });
    void queryClient.invalidateQueries({
      queryKey: ["messages", "unread-count"],
    });
  }, [detail.data, queryClient]);

  return (
    <section
      aria-label="گفت‌وگو با نماینده منبع"
      className="mt-4 min-w-0 space-y-4 rounded-xl border p-4"
      dir="rtl"
    >
      <h3 className="font-semibold">گفت‌وگو با نماینده منبع</h3>
      {detail.isPending ? (
        <p role="status">در حال بارگذاری گفت‌وگو…</p>
      ) : detail.isError ? (
        <div role="alert">
          <p>بارگذاری گفت‌وگو انجام نشد.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            تلاش دوباره
          </Button>
        </div>
      ) : detail.data.kind === "source_conversation" ? (
        <>
          <p className="text-muted-foreground text-sm">
            پیام‌ها تصمیم بررسی یا وضعیت استخراج و انتشار را تغییر نمی‌دهند.
          </p>
          <ol
            aria-label="گفت‌وگوی منبع"
            className="max-h-96 space-y-3 overflow-y-auto"
          >
            {detail.data.entries.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "rounded-xl border p-4",
                  entry.mine ? "bg-primary/5 ms-4" : "bg-muted/50 me-4",
                )}
              >
                <p className="mb-2 text-xs font-semibold">
                  {entry.author_name}
                </p>
                <p className="text-sm leading-7 break-words whitespace-pre-wrap">
                  {entry.body}
                </p>
                <time
                  dateTime={entry.created_at}
                  className="text-muted-foreground mt-3 block text-xs"
                >
                  {new Date(entry.created_at).toLocaleString("fa-IR")}
                </time>
              </li>
            ))}
          </ol>
          {detail.data.entries.length === 0 && (
            <p className="text-muted-foreground text-sm">
              هنوز پیامی در این گفت‌وگو نیست.
            </p>
          )}
          {detail.data.reply_allowed ? (
            <MessageTextForm
              id={`operator-reply-${conversationId}`}
              pending={reply.isPending}
              error={reply.isError}
              onSubmit={(body, onSuccess) => reply.mutate(body, { onSuccess })}
            />
          ) : (
            <p>این گفت‌وگو فقط خواندنی است.</p>
          )}
        </>
      ) : (
        <p role="alert">گفت‌وگوی منبع در دسترس نیست.</p>
      )}
    </section>
  );
}
