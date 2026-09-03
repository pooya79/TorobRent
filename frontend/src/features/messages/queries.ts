import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type MessageSummary = components["schemas"]["MessageSummary"];
export type MessageDetail = components["schemas"]["MessageDetail"];
export type MessagePage = components["schemas"]["PaginatedMessageSummaryList"];

export type MessageFilter =
  | "all"
  | "system_notification"
  | "listing_inquiry"
  | "support_request"
  | "unread";

export function messagesQueryOptions(filter: MessageFilter, page = 1) {
  return queryOptions({
    queryKey: ["messages", "feed", filter, page],
    queryFn: async () => {
      const filterQuery =
        filter === "unread"
          ? { unread: true }
          : filter === "system_notification"
            ? { kind: "system_notification" as const }
            : filter === "listing_inquiry"
              ? { kind: "listing_inquiry" as const }
              : filter === "support_request"
                ? { kind: "support_request" as const }
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

export async function replyToSupportRequest(
  supportRequestId: string,
  body: string,
) {
  const { data, error } = await api.POST(
    "/api/v1/messages/support-requests/{support_request_id}/replies/",
    {
      params: { path: { support_request_id: supportRequestId } },
      body: { body },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function editSupportMessage(
  supportRequestId: string,
  supportMessageId: string,
  body: string,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/messages/support-requests/{support_request_id}/messages/{support_message_id}/",
    {
      params: {
        path: {
          support_request_id: supportRequestId,
          support_message_id: supportMessageId,
        },
      },
      body: { body },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function chooseDisplayName(displayName: string) {
  const { data, error } = await api.PUT("/api/v1/users/me/display-name/", {
    body: { display_name: displayName },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export async function startListingInquiry(listingId: string, body: string) {
  const { data, error } = await api.POST(
    "/api/v1/messages/listing-inquiries/",
    { body: { listing_id: listingId, body } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function replyToListingInquiry(inquiryId: string, body: string) {
  const { data, error } = await api.POST(
    "/api/v1/messages/listing-inquiries/{inquiry_id}/replies/",
    {
      params: { path: { inquiry_id: inquiryId } },
      body: { body },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function blockListingInquiryCounterpart(inquiryId: string) {
  const { data, error } = await api.POST(
    "/api/v1/messages/listing-inquiries/{inquiry_id}/block/",
    { params: { path: { inquiry_id: inquiryId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function reportListingInquiry(
  inquiryId: string,
  messageId: string | null,
  explanation: string,
) {
  const { data, error } = await api.POST(
    "/api/v1/messages/listing-inquiries/{inquiry_id}/reports/",
    {
      params: { path: { inquiry_id: inquiryId } },
      body: { message_id: messageId, explanation },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function editListingInquiryMessage(
  inquiryId: string,
  messageId: string,
  body: string,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/messages/listing-inquiries/{inquiry_id}/messages/{message_id}/",
    {
      params: { path: { inquiry_id: inquiryId, message_id: messageId } },
      body: { body },
    },
  );
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
