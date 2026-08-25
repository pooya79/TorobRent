import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components, operations } from "@/lib/api/schema";

export type SupportRequest = components["schemas"]["SupportRequest"];
export type SupportRequestQueueItem =
  components["schemas"]["SupportRequestQueue"];
export type SupportRequestStatus =
  components["schemas"]["SupportRequestStatusEnum"];
export type IntakeKind = components["schemas"]["IntakeKindEnum"];
export type SupportClassification =
  components["schemas"]["SupportClassificationEnum"];
export type SupportPriority = NonNullable<SupportRequestQueueItem["priority"]>;
export type SupportTriageInput = components["schemas"]["PatchedSupportTriage"];
export type SupportReassignmentInput =
  components["schemas"]["SupportReassignment"];
type GeneratedSupportQueueFilters = NonNullable<
  operations["v1_operator_support_requests_list"]["parameters"]["query"]
>;
export type OperatorUuid = `${string}-${string}-${string}-${string}-${string}`;
export type AssigneeFacet =
  "unassigned" | "assigned" | "mine" | "other" | OperatorUuid;
export type SupportQueueFilters = Omit<
  GeneratedSupportQueueFilters,
  "assignee"
> & { assignee?: AssigneeFacet };

export function supportQueueQueryOptions(filters: SupportQueueFilters = {}) {
  return queryOptions({
    queryKey: ["operator-support-requests", filters] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/support-requests/",
        { params: { query: filters } },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function supportRequestQueryOptions(supportRequestId: string) {
  return queryOptions({
    queryKey: [
      "operator-support-requests",
      "detail",
      supportRequestId,
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/support-requests/{support_request_id}/",
        { params: { path: { support_request_id: supportRequestId } } },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    enabled: Boolean(supportRequestId),
  });
}

export async function claimSupportRequest(supportRequestId: string) {
  const { data, error } = await api.POST(
    "/api/v1/operator/support-requests/{support_request_id}/claim/",
    { params: { path: { support_request_id: supportRequestId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function releaseSupportRequest(supportRequestId: string) {
  const { error } = await api.DELETE(
    "/api/v1/operator/support-requests/{support_request_id}/claim/",
    { params: { path: { support_request_id: supportRequestId } } },
  );
  if (error) throw apiError(error);
}

export async function triageSupportRequest(
  supportRequestId: string,
  input: SupportTriageInput,
) {
  const { error } = await api.PATCH(
    "/api/v1/operator/support-requests/{support_request_id}/triage/",
    {
      params: { path: { support_request_id: supportRequestId } },
      body: input,
    },
  );
  if (error) throw apiError(error);
}

export async function reassignSupportRequest(
  supportRequestId: string,
  input: SupportReassignmentInput,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/support-requests/{support_request_id}/reassign/",
    {
      params: { path: { support_request_id: supportRequestId } },
      body: input,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}
