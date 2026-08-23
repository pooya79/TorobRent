import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type Submission = components["schemas"]["Submission"];
export type SubmissionStepUpdate =
  components["schemas"]["PatchedSubmissionStepUpdate"];
export type SubmissionImage = components["schemas"]["SubmissionImage"];
export type SubmissionImageOrder =
  components["schemas"]["PatchedSubmissionImageOrder"];
export type SubmissionApproval = components["schemas"]["SubmissionApproval"];

export type OperatorQueueFilters = {
  state?: string;
  source?: string;
  city?: string;
  district?: string;
  neighborhood?: string;
  updated_after?: string;
  updated_before?: string;
  ordering?: "newest" | "oldest";
};

function multipartBody(body: { file: string }) {
  const file = body.file as unknown as File;
  const form = new FormData();
  form.append("file", file, file.name);
  return form;
}

export const submissionsQueryOptions = queryOptions({
  queryKey: ["submissions"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/submissions/");
    if (error || !data) throw apiError(error);
    return data;
  },
});

export function submissionQueryOptions(submissionId: string) {
  return queryOptions({
    queryKey: ["submissions", submissionId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/submissions/{submission_id}/",
        { params: { path: { submission_id: submissionId } } },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    refetchInterval: (query) =>
      query.state.data?.images.some(
        (image) => image.status === "pending" || image.status === "processing",
      )
        ? 1500
        : false,
  });
}

export async function createSubmission(role: "owner" | "agent") {
  const { data, error } = await api.POST("/api/v1/submissions/", {
    body: { role },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export async function saveSubmissionStep(
  submissionId: string,
  body: SubmissionStepUpdate,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/submissions/{submission_id}/",
    {
      params: { path: { submission_id: submissionId } },
      body,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function submitSubmission(submissionId: string) {
  const { data, error } = await api.POST(
    "/api/v1/submissions/{submission_id}/submit/",
    { params: { path: { submission_id: submissionId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

type ListingAvailabilityPath =
  | "/api/v1/submissions/{submission_id}/confirm-availability/"
  | "/api/v1/submissions/{submission_id}/mark-unavailable/"
  | "/api/v1/submissions/{submission_id}/archive/";

async function changeListingAvailability(
  submissionId: string,
  path: ListingAvailabilityPath,
) {
  const { data, error } = await api.POST(path, {
    params: { path: { submission_id: submissionId } },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export async function confirmListingAvailability(submissionId: string) {
  return changeListingAvailability(
    submissionId,
    "/api/v1/submissions/{submission_id}/confirm-availability/",
  );
}

export async function markListingUnavailable(submissionId: string) {
  return changeListingAvailability(
    submissionId,
    "/api/v1/submissions/{submission_id}/mark-unavailable/",
  );
}

export async function archiveListing(submissionId: string) {
  return changeListingAvailability(
    submissionId,
    "/api/v1/submissions/{submission_id}/archive/",
  );
}

export function operatorQueueQueryOptions(filters: OperatorQueueFilters = {}) {
  return queryOptions({
    queryKey: ["operator-submissions", filters] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/operator/submissions/", {
        params: { query: filters },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
  });
}

export async function requestSubmissionChanges(
  submissionId: string,
  reason: string,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/submissions/{submission_id}/request-changes/",
    {
      params: { path: { submission_id: submissionId } },
      body: { reason },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function rejectSubmission(submissionId: string, reason: string) {
  const { data, error } = await api.POST(
    "/api/v1/operator/submissions/{submission_id}/reject/",
    {
      params: { path: { submission_id: submissionId } },
      body: { reason },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function approveSubmission(
  submissionId: string,
  approval: SubmissionApproval,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/submissions/{submission_id}/approve/",
    {
      params: { path: { submission_id: submissionId } },
      body: approval,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function uploadSubmissionImage(submissionId: string, file: File) {
  const { data, error } = await api.POST(
    "/api/v1/submissions/{submission_id}/images/",
    {
      params: { path: { submission_id: submissionId } },
      body: { file: file as unknown as string },
      bodySerializer: multipartBody,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function reorderSubmissionImages(
  submissionId: string,
  body: SubmissionImageOrder,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/submissions/{submission_id}/images/",
    {
      params: { path: { submission_id: submissionId } },
      body,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function removeSubmissionImage(
  submissionId: string,
  imageId: string,
) {
  const { error } = await api.DELETE(
    "/api/v1/submissions/{submission_id}/images/{image_id}/",
    {
      params: {
        path: { submission_id: submissionId, image_id: imageId },
      },
    },
  );
  if (error) throw apiError(error);
}

export async function retrySubmissionImage(
  submissionId: string,
  imageId: string,
  file: File,
) {
  const { data, error } = await api.POST(
    "/api/v1/submissions/{submission_id}/images/{image_id}/retry/",
    {
      params: {
        path: { submission_id: submissionId, image_id: imageId },
      },
      body: { file: file as unknown as string },
      bodySerializer: multipartBody,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}
