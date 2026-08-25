import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorSupportPage } from "@/pages/OperatorSupportPage";

export default function OperatorSupportRoute() {
  return (
    <OperatorCapabilityRoute
      capability={["handle_support", "handle_privacy_requests"]}
    >
      <OperatorSupportPage />
    </OperatorCapabilityRoute>
  );
}
