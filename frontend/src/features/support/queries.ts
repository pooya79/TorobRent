import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components, operations } from "@/lib/api/schema";

export type SupportRequest = components["schemas"]["SupportRequest"];
export type SupportRequestQueueItem =
  components["schemas"]["SupportRequestQueue"];
export type SupportWorkloadSummary =
  components["schemas"]["SupportWorkloadSummary"];
export type SupportRequestStatus =
  components["schemas"]["SupportRequestStatusEnum"];
export type IntakeKind = components["schemas"]["IntakeKindEnum"];
export type SupportClassification =
  components["schemas"]["SupportClassificationEnum"];
export type SupportPriority = NonNullable<SupportRequestQueueItem["priority"]>;
export type SupportTriageInput = components["schemas"]["PatchedSupportTriage"];
export type SupportReassignmentInput =
  components["schemas"]["SupportReassignment"];
export type SupportNoteInput =
  components["schemas"]["SupportRequestNoteCreate"];
export type SupportExternalContactInput =
  components["schemas"]["SupportExternalContactCreate"];
export type SupportResolutionInput = components["schemas"]["SupportResolution"];
export type SupportReopenInput = components["schemas"]["SupportReopen"];
export type SupportIdentityVerificationInput =
  components["schemas"]["SupportIdentityVerificationCreate"];
export type SupportPrivacyActionInput =
  components["schemas"]["SupportPrivacyActionCreate"];
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

async function requireSupportCommandData<Data>(
  request: Promise<{ data?: Data; error?: unknown }>,
) {
  const { data, error } = await request;
  if (error || !data) throw apiError(error);
  return data;
}

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

export function supportWorkloadSummaryQueryOptions(enabled = true) {
  return queryOptions({
    queryKey: ["operator-support-requests", "summary"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/support-requests/summary/",
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    enabled,
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
  return requireSupportCommandData(
    api.POST("/api/v1/operator/support-requests/{support_request_id}/claim/", {
      params: { path: { support_request_id: supportRequestId } },
    }),
  );
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
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/reassign/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: input,
      },
    ),
  );
}

export async function addSupportNote(
  supportRequestId: string,
  input: SupportNoteInput,
) {
  return requireSupportCommandData(
    api.POST("/api/v1/operator/support-requests/{support_request_id}/notes/", {
      params: { path: { support_request_id: supportRequestId } },
      body: input,
    }),
  );
}

export async function postSupportReply(supportRequestId: string, body: string) {
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/replies/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: { body },
      },
    ),
  );
}

export async function editSupportReply(
  supportRequestId: string,
  supportMessageId: string,
  body: string,
) {
  return requireSupportCommandData(
    api.PATCH(
      "/api/v1/operator/support-requests/{support_request_id}/replies/{support_message_id}/",
      {
        params: {
          path: {
            support_request_id: supportRequestId,
            support_message_id: supportMessageId,
          },
        },
        body: { body },
      },
    ),
  );
}

export async function recordSupportExternalContact(
  supportRequestId: string,
  input: SupportExternalContactInput,
) {
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/external-contacts/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: input,
      },
    ),
  );
}

export async function resolveSupportRequest(
  supportRequestId: string,
  input: SupportResolutionInput,
) {
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/resolve/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: input,
      },
    ),
  );
}

export async function reopenSupportRequest(
  supportRequestId: string,
  input: SupportReopenInput,
) {
  return requireSupportCommandData(
    api.POST("/api/v1/operator/support-requests/{support_request_id}/reopen/", {
      params: { path: { support_request_id: supportRequestId } },
      body: input,
    }),
  );
}

export async function recordSupportIdentityVerification(
  supportRequestId: string,
  input: SupportIdentityVerificationInput,
) {
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/identity-verifications/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: input,
      },
    ),
  );
}

export async function recordSupportPrivacyAction(
  supportRequestId: string,
  input: SupportPrivacyActionInput,
) {
  return requireSupportCommandData(
    api.POST(
      "/api/v1/operator/support-requests/{support_request_id}/privacy-actions/",
      {
        params: { path: { support_request_id: supportRequestId } },
        body: input,
      },
    ),
  );
}
