import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type Submission = components["schemas"]["Submission"];
export type SubmissionStepUpdate =
  components["schemas"]["PatchedSubmissionStepUpdate"];

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
