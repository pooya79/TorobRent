import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { openSourceConversation } from "@/features/messages/queries";

export function SourceConversationButton({
  proposalId,
  operator = false,
}: {
  proposalId: string;
  operator?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: () => openSourceConversation(proposalId),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void navigate(conversation.href);
    },
  });
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={open.isPending}
        onClick={() => open.mutate()}
      >
        {open.isPending
          ? "در حال باز کردن گفت‌وگو…"
          : operator
            ? "گفت‌وگو با نماینده منبع"
            : "تماس با تیم بررسی"}
      </Button>
      {open.isError && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          گفت‌وگو در دسترس نیست. وضعیت مسئولیت را تازه کنید و دوباره تلاش کنید.
        </p>
      )}
    </div>
  );
}
