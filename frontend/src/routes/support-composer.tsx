import { ProtectedMessageCenterRoute } from "@/features/messages/ProtectedMessageCenterRoute";
import { SupportComposerPage } from "@/pages/SupportComposerPage";

export default function SupportComposerRoute() {
  return (
    <ProtectedMessageCenterRoute>
      <SupportComposerPage />
    </ProtectedMessageCenterRoute>
  );
}
