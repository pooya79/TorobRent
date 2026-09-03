import { OperatorCapabilityRoute } from "@/features/operator/OperatorWorkspace";
import { OperatorConversationReportsPage } from "@/pages/OperatorConversationReportsPage";

export default function OperatorConversationReportsRoute() {
  return (
    <OperatorCapabilityRoute capability="moderate_conversations">
      <OperatorConversationReportsPage />
    </OperatorCapabilityRoute>
  );
}
