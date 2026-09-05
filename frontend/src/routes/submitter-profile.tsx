import { ProtectedAccountRoute } from "@/features/account/ProtectedAccountRoute";
import { SubmitterProfilePage } from "@/pages/SubmitterProfilePage";

export default function SubmitterProfileRoute() {
  return (
    <ProtectedAccountRoute>
      <SubmitterProfilePage />
    </ProtectedAccountRoute>
  );
}
