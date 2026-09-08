import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorSourceProposalDetailPage } from "@/pages/OperatorSourceProposalDetailPage";
export default function OperatorSourceProposalDetailRoute() {
  return (
    <OperatorCapabilityRoute
      capability={["review_source_proposals", "manage_operator_queues"]}
    >
      <OperatorSourceProposalDetailPage />
    </OperatorCapabilityRoute>
  );
}
