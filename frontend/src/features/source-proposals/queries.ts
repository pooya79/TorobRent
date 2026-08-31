import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type SourceProposal = components["schemas"]["SourceProposal"];
export type SourceProposalDetails =
  components["schemas"]["PatchedSourceProposalDetails"];
export type SourceProposalDraft =
  components["schemas"]["PatchedSourceProposalDraft"];

export const sourceProposalsQueryOptions = queryOptions({
  queryKey: ["source-proposals"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/source-proposals/");
    if (error || !data) throw apiError(error);
    return data;
  },
});

export async function resumeOrCreateSourceProposal(startNew = false) {
  const { data, error } = await api.POST("/api/v1/source-proposals/", {
    body: { start_new: startNew },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export async function autosaveSourceProposalDraft(
  proposalId: string,
  body: SourceProposalDraft,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/source-proposals/{proposal_id}/draft/",
    { params: { path: { proposal_id: proposalId } }, body },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function saveSourceProposalDetails(
  proposalId: string,
  body: SourceProposalDetails,
) {
  const { data, error } = await api.PATCH(
    "/api/v1/source-proposals/{proposal_id}/",
    { params: { path: { proposal_id: proposalId } }, body },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function generateSourceProposalPreview(proposalId: string) {
  const { data, error } = await api.POST(
    "/api/v1/source-proposals/{proposal_id}/preview/",
    { params: { path: { proposal_id: proposalId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function submitSourceProposal(proposalId: string) {
  const { data, error } = await api.POST(
    "/api/v1/source-proposals/{proposal_id}/submit/",
    {
      params: { path: { proposal_id: proposalId } },
      body: { preview_confirmed: true },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}
