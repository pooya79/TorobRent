import { ProtectedMessageCenterRoute } from "@/features/messages/ProtectedMessageCenterRoute";
import { MessageCenterPage } from "@/pages/MessageCenterPage";

export default function MessageDetailRoute() {
  return (
    <ProtectedMessageCenterRoute>
      <MessageCenterPage />
    </ProtectedMessageCenterRoute>
  );
}
