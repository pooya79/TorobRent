import { ProtectedSubmitterRoute } from "@/features/session/ProtectedSubmitterRoute";
import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";

export default function ProtectedDashboardRoute() {
  return (
    <ProtectedSubmitterRoute>
      <SubmitterDashboardPage />
    </ProtectedSubmitterRoute>
  );
}
