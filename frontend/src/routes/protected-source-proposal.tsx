import { ProtectedSubmitterRoute } from "@/features/session/ProtectedSubmitterRoute";
import { SourceProposalPage } from "@/pages/SourceProposalPage";

export default function ProtectedSourceProposalRoute() {
  return (
    <ProtectedSubmitterRoute>
      <SourceProposalPage />
    </ProtectedSubmitterRoute>
  );
}
