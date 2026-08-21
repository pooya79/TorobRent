import { ProtectedSubmitterRoute } from "@/features/session/ProtectedSubmitterRoute";
import { AddSubmissionPage } from "@/pages/AddSubmissionPage";

export default function ProtectedAddSubmissionRoute() {
  return (
    <ProtectedSubmitterRoute>
      <AddSubmissionPage />
    </ProtectedSubmitterRoute>
  );
}
