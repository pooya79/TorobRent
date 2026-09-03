import { ProtectedMessageCenterRoute } from "@/features/messages/ProtectedMessageCenterRoute";
import { MessageCenterPage } from "@/pages/MessageCenterPage";

export default function MessageCenterRoute() {
  return (
    <ProtectedMessageCenterRoute>
      <MessageCenterPage />
    </ProtectedMessageCenterRoute>
  );
}
