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
        {paused
          ? "برای ادامه، یک استخراج تازه با پروفایل تأییدشده و حدود فعلی شروع می‌شود. نتایج ناتمام قبلی فقط در سابقه می‌مانند."
          : "توقف، دریافت صفحات و انتشار نتایج ناتمام را متوقف می‌کند. آگهی‌های منتشرشده تا پایان اعتبارشان باقی می‌مانند."}
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
              <label
                key={value}
                className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 hover:bg-muted flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm leading-6"
              >
                <Input
                  aria-label={label}
                  aria-describedby={`resume-description-${proposal.id}-${value}`}
                  type="radio"
                  className="mt-1 size-4 shrink-0"
                  name={`resume-mode-${proposal.id}`}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                <span className="grid gap-1">
                  <span className="font-medium">{label}</span>
                  <span
                    id={`resume-description-${proposal.id}-${value}`}
                    className="text-muted-foreground"
                  >
                    {value === "approval_required"
                      ? "صفحات دوباره خوانده می‌شوند؛ نتایج تازه تا تأیید شما منتشر نمی‌شوند."
                      : "صفحات دوباره خوانده می‌شوند؛ نتایج معتبر تازه بدون تأیید جداگانه منتشر می‌شوند."}
                  </span>
                </span>
              </label>
            ))}
          </>
        )}
        {paused && (
          <p
            id={`resume-hint-${proposal.id}`}
            role="status"
            className="text-sm"
          >
            {!mode
              ? "برای فعال شدن دکمه، روش انتشار نتایج تازه را انتخاب کنید."
              : "با ازسرگیری، درخواست تازه در صف استخراج قرار می‌گیرد."}
          </p>
        )}
        <Button
          type="submit"
          variant={paused ? "default" : "outline"}
          aria-describedby={paused ? `resume-hint-${proposal.id}` : undefined}
          disabled={!!paused && !mode}
        >
          {mutation.isPending
            ? "در حال ثبت…"
            : paused
              ? "ازسرگیری با استخراج تازه"
              : "توقف پردازش منبع"}
        </Button>
      </fieldset>
      {mutation.isSuccess && (
        <p role="status" className="text-sm">
          {paused
            ? "توقف پردازش ثبت شد."
            : "درخواست استخراج تازه ثبت شد؛ شروع و پیشرفت آن را در وضعیت بالا ببینید."}
        </p>
      )}
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
