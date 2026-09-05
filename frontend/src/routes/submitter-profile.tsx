import { ProtectedSubmitterRoute } from "@/features/session/ProtectedSubmitterRoute";
import { SubmitterProfilePage } from "@/pages/SubmitterProfilePage";

export default function SubmitterProfileRoute() {
  return (
    <ProtectedSubmitterRoute>
      <SubmitterProfilePage />
    </ProtectedSubmitterRoute>
  );
}
