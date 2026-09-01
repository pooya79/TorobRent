import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorSourceProposalPage } from "@/pages/OperatorSourceProposalPage";

export default function OperatorSourceProposalsRoute() {
  return (
    <OperatorCapabilityRoute capability="review_source_proposals">
      <OperatorSourceProposalPage />
    </OperatorCapabilityRoute>
  );
}
