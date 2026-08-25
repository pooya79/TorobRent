import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorReviewPage } from "@/pages/OperatorReviewPage";

export default function OperatorSubmissionsRoute() {
  return (
    <OperatorCapabilityRoute capability="review_submissions">
      <OperatorReviewPage />
    </OperatorCapabilityRoute>
  );
}
