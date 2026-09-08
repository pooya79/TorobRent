import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/errors";
import {
  changeSourcePublicationMode,
  type OperatorSourceProposal,
} from "./queries";

export function SourcePublicationModePanel({
  proposal,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const assignment = proposal.assignment;
  const [selection, setSelection] = useState<
    "automatic" | "approval_required" | null
  >(null);
  const mode = selection ?? assignment?.review_mode;
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => {
      if (!assignment?.active_profile_version || !selection)
        throw new Error("روش انتشار را انتخاب کنید.");
      return changeSourcePublicationMode(proposal.id, {
        reviewed_profile_version: assignment.active_profile_version.id,
        reviewed_mode_revision: assignment.mode_revision,
        review_mode: selection,
      });
    },
    onSuccess: (updated) => {
      setSelection(null);
      onUpdate(updated);
    },
    onError: () => {
      setSelection(null);
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  if (!assignment?.active_profile_version) return null;
  return (
    <form
      className="grid gap-3 rounded-lg border p-4"
      aria-label="روش انتشار منبع"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <fieldset className="grid gap-3" disabled={mutation.isPending}>
        <legend className="mb-3 font-semibold">روش انتشار منبع</legend>
        <p className="text-muted-foreground text-sm">
          انتخاب کنید نتایج معتبر خودکار منتشر شوند یا منتظر تأیید اپراتور
          بمانند.
        </p>
        <details className="text-muted-foreground text-sm">
          <summary className="text-foreground cursor-pointer">
            اثر تغییر روش بر نتایج قبلی
          </summary>
          <div className="mt-3">
            <p className="text-muted-foreground text-sm">
              فعال‌سازی خودکار فقط برای درخواست‌های تازه است؛ نتایج قبلی با
              تأیید صریح منتشر می‌شود. غیرفعال‌سازی، انتشار خودکار کارهای در صف
              و در حال اجرا را هم متوقف می‌کند و نتایج برای بررسی باقی می‌ماند.
            </p>
          </div>
        </details>
        {(
          [
            ["approval_required", "نیازمند تأیید انتشار"],
            ["automatic", "انتشار خودکار نتایج معتبر"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:bg-muted flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-6"
          >
            <Input
              type="radio"
              name={`publication-mode-${proposal.id}`}
              className="mt-1 size-4 shrink-0"
              value={value}
              checked={mode === value}
              onChange={() => setSelection(value)}
            />
            {label}
          </label>
        ))}
        <Button
          type="submit"
          disabled={!selection || selection === assignment.review_mode}
        >
          ثبت روش انتشار
        </Button>
      </fieldset>
      {mutation.error && (
        <p role="alert">
          {errorMessage(
            mutation.error,
            "تغییر روش انتشار ممکن نشد؛ پرونده را تازه کنید.",
          )}
        </p>
      )}
    </form>
  );
}
