import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type ConversationReportDecision =
  components["schemas"]["ConversationReportDecision"];

export function conversationReportQueueQueryOptions() {
  return queryOptions({
    queryKey: ["operator-conversation-reports"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/conversation-reports/",
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function conversationReportQueryOptions(reportId: string) {
  return queryOptions({
    queryKey: ["operator-conversation-reports", "detail", reportId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/conversation-reports/{report_id}/",
        { params: { path: { report_id: reportId } } },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    enabled: Boolean(reportId),
  });
}

export async function decideConversationReport(
  reportId: string,
  input: ConversationReportDecision,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/conversation-reports/{report_id}/decision/",
    {
      params: { path: { report_id: reportId } },
      body: input,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function releaseConversationReportEvidence(
  reportId: string,
  internalNote: string,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/conversation-reports/{report_id}/evidence-release/",
    {
      params: { path: { report_id: reportId } },
      body: { internal_note: internalNote },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}
