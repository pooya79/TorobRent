import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

export type SourceProposal = components["schemas"]["SourceProposal"];
export type SourceProposalDetails =
  components["schemas"]["PatchedSourceProposalDetails"];
export type SourceProposalDraft =
  components["schemas"]["PatchedSourceProposalDraft"];
export type OperatorSourceProposal =
  components["schemas"]["OperatorSourceProposal"];
export type ExternalListingCandidate =
  components["schemas"]["ExternalListingCandidate"];

export const sourceProposalsQueryOptions = queryOptions({
  queryKey: ["source-proposals"] as const,
  refetchInterval: 5000,
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

export async function getSourceProposal(proposalId: string) {
  const { data, error } = await api.GET(
    "/api/v1/source-proposals/{proposal_id}/",
    { params: { path: { proposal_id: proposalId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function removeSourceProposalDraft(proposalId: string) {
  const { error } = await api.DELETE(
    "/api/v1/source-proposals/{proposal_id}/",
    { params: { path: { proposal_id: proposalId } } },
  );
  if (error) throw apiError(error);
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

export const operatorSourceProposalsQueryOptions = queryOptions({
  queryKey: ["operator-source-proposals"] as const,
  refetchInterval: 5000,
  queryFn: async () => {
    const { data, error } = await api.GET("/api/v1/operator/source-proposals/");
    if (error || !data) throw apiError(error);
    return data;
  },
});

export async function claimSourceProposal(proposalId: string) {
  const { data, error } = await api.POST(
    "/api/v1/operator/source-proposals/{proposal_id}/claim/",
    { params: { path: { proposal_id: proposalId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function decideSourceProposal(
  proposalId: string,
  decision: "request-changes" | "reject" | "approve",
  revision: number,
  reason: string,
  profileVersion?: string,
) {
  if (decision === "approve") {
    const { data, error } = await api.POST(
      "/api/v1/operator/source-proposals/{proposal_id}/approve/",
      {
        params: { path: { proposal_id: proposalId } },
        body: { reviewed_revision: revision, confirmed: true },
      },
    );
    if (error || !data) throw apiError(error);
    return data;
  }
  const path =
    decision === "reject"
      ? "/api/v1/operator/source-proposals/{proposal_id}/reject/"
      : "/api/v1/operator/source-proposals/{proposal_id}/request-changes/";
  const { data, error } = await api.POST(path, {
    params: { path: { proposal_id: proposalId } },
    body: {
      reviewed_revision: revision,
      reason,
      ...(profileVersion ? { reviewed_profile_version: profileVersion } : {}),
    },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export const operatorExternalListingCandidatesQueryOptions = queryOptions({
  queryKey: ["operator-external-listing-candidates"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET(
      "/api/v1/operator/external-listing-candidates/",
    );
    if (error || !data) throw apiError(error);
    return data;
  },
});

export async function claimExternalListingCandidate(candidateId: string) {
  const { data, error } = await api.POST(
    "/api/v1/operator/external-listing-candidates/{candidate_id}/claim/",
    { params: { path: { candidate_id: candidateId } } },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function decideExternalListingCandidate(
  candidateId: string,
  decision: "request-changes" | "reject" | "approve",
  revision: number,
  reason: string,
) {
  if (decision === "approve") {
    const { data, error } = await api.POST(
      "/api/v1/operator/external-listing-candidates/{candidate_id}/approve/",
      {
        params: { path: { candidate_id: candidateId } },
        body: { reviewed_revision: revision, confirmed: true },
      },
    );
    if (error || !data) throw apiError(error);
    return data;
  }
  const path =
    decision === "reject"
      ? "/api/v1/operator/external-listing-candidates/{candidate_id}/reject/"
      : "/api/v1/operator/external-listing-candidates/{candidate_id}/request-changes/";
  const { data, error } = await api.POST(path, {
    params: { path: { candidate_id: candidateId } },
    body: { reviewed_revision: revision, reason },
  });
  if (error || !data) throw apiError(error);
  return data;
}

export async function releaseSourceProposal(
  proposalId: string,
  revision: number,
  reason: string,
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/source-proposals/{proposal_id}/claim/release/",
    {
      params: { path: { proposal_id: proposalId } },
      body: { reviewed_revision: revision, reason },
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function editSourceProfile(
  proposalId: string,
  body: components["schemas"]["SourceProfileEdit"],
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/source-proposals/{proposal_id}/profile/edit/",
    {
      params: { path: { proposal_id: proposalId } },
      body,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}

export async function approveSourceProfile(
  proposalId: string,
  body: components["schemas"]["SourceProfileApproval"],
) {
  const { data, error } = await api.POST(
    "/api/v1/operator/source-proposals/{proposal_id}/profile/approve/",
    {
      params: { path: { proposal_id: proposalId } },
      body,
    },
  );
  if (error || !data) throw apiError(error);
  return data;
}
