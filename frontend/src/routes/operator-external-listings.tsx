import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorExternalListingsPage } from "@/pages/OperatorExternalListingsPage";
export default function OperatorExternalListingsRoute() {
  return (
    <OperatorCapabilityRoute capability="review_source_proposals">
      <OperatorExternalListingsPage />
    </OperatorCapabilityRoute>
  );
}
