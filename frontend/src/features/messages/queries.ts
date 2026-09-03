import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type MessageSummary = components["schemas"]["MessageSummary"];
export type MessageDetail = components["schemas"]["MessageDetail"];
export type MessagePage = components["schemas"]["PaginatedMessageSummaryList"];

export type MessageFilter = "all" | "system_notification" | "unread";

export function messagesQueryOptions(filter: MessageFilter, page = 1) {
  return queryOptions({
    queryKey: ["messages", "feed", filter, page],
    queryFn: async () => {
      const filterQuery =
        filter === "unread"
          ? { unread: true }
          : filter === "system_notification"
            ? { kind: "system_notification" as const }
            : undefined;
      const query = { ...filterQuery, ...(page > 1 ? { page } : {}) };
      const { data, error } = await api.GET("/api/v1/messages/", {
        params: { query },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
  });
}

export function messageDetailQueryOptions(messageId: string | undefined) {
  return queryOptions({
    queryKey: ["messages", "detail", messageId],
    enabled: Boolean(messageId),
    queryFn: async () => {
      if (!messageId) throw new Error("Message id is required");
      const { data, error } = await api.GET("/api/v1/messages/{message_id}/", {
        params: { path: { message_id: messageId } },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
  });
}

export async function markMessageUnread(messageId: string) {
  const { data, error } = await api.PATCH("/api/v1/messages/{message_id}/", {
    params: { path: { message_id: messageId } },
    body: { read: false },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export const unreadMessageCountQuery = queryOptions({
  queryKey: ["messages", "unread-count"],
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/messages/unread-count/");
    if (error || !data) throw apiError(error);
    return data;
  },
});
