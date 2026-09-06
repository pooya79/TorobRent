import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/errors";
import { changeSourceProcessing, type OperatorSourceProposal } from "./queries";

export function SourceProcessingPanel({
  proposal,
  onUpdate,
}: {
  proposal: OperatorSourceProposal;
  onUpdate: (proposal: OperatorSourceProposal) => void;
}) {
  const assignment = proposal.assignment;
  const paused = assignment?.source.processing_paused;
  const [mode, setMode] = useState<"automatic" | "approval_required" | null>(
    null,
  );
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => {
      if (!assignment || (paused && !mode))
        throw new Error("روش انتشار تازه را انتخاب کنید.");
      return changeSourceProcessing(proposal.id, {
        action: paused ? "resume" : "pause",
        reviewed_processing_revision: assignment.source.processing_revision,
        ...(paused && mode ? { review_mode: mode } : {}),
      });
    },
    onSuccess: (updated) => {
      setMode(null);
      onUpdate(updated);
      void queryClient.invalidateQueries({
        queryKey: ["operator-external-listing-candidates"],
      });
    },
    onError: () => {
      setMode(null);
      void queryClient.invalidateQueries({
        queryKey: ["operator-source-proposals"],
      });
    },
  });
  return (
    <form
      aria-label="کنترل پردازش منبع"
      className="grid gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h4 className="font-semibold">کنترل پردازش منبع</h4>
      <p className="text-muted-foreground text-sm">
        توقف، دریافت صفحات و انتشار نتایج ناتمام را متوقف می‌کند. آگهی‌های
        منتشرشده تا پایان اعتبار خود باقی می‌مانند. ازسرگیری، صفحات را با
        پروفایل فعال و محدودیت‌های فعلی دوباره دریافت می‌کند؛ نتایج قدیمی فقط در
        سابقه می‌مانند.
      </p>
      <fieldset disabled={mutation.isPending} className="grid gap-3">
        {paused && (
          <>
            <legend className="mb-3">
              روش انتشار استخراج تازه را انتخاب کنید
            </legend>
            {(
              [
                ["approval_required", "بررسی اپراتور پیش از انتشار تازه"],
                ["automatic", "انتشار خودکار نتایج معتبر تازه"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <Input
                  type="radio"
                  className="size-4"
                  name={`resume-mode-${proposal.id}`}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {label}
              </label>
            ))}
          </>
        )}
        <Button type="submit" disabled={!!paused && !mode}>
          {paused ? "ازسرگیری با استخراج تازه" : "توقف پردازش منبع"}
        </Button>
      </fieldset>
      {mutation.error && (
        <p role="alert">
          {errorMessage(
            mutation.error,
            "تغییر وضعیت ممکن نشد؛ پرونده را تازه کنید.",
          )}
        </p>
      )}
    </form>
  );
}
