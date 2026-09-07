import { ProtectedAccountRoute } from "@/features/account/ProtectedAccountRoute";
import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";

export default function ProtectedDashboardRoute() {
  return (
    <ProtectedAccountRoute>
      <SubmitterDashboardPage />
    </ProtectedAccountRoute>
  );
}
