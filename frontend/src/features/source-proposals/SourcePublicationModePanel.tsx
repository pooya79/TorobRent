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
          استخراج در هر دو حالت انجام می‌شود. انتخاب کنید آگهی‌های به‌دست‌آمده
          چه زمانی در سایت نمایش داده شوند.
        </p>
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
              aria-label={label}
              aria-describedby={`publication-description-${proposal.id}-${value}`}
              type="radio"
              name={`publication-mode-${proposal.id}`}
              className="mt-1 size-4 shrink-0"
              value={value}
              checked={mode === value}
              onChange={() => setSelection(value)}
            />
            <span className="grid gap-1">
              <span className="font-medium">{label}</span>
              <span
                id={`publication-description-${proposal.id}-${value}`}
                className="text-muted-foreground"
              >
                {value === "approval_required"
                  ? "سامانه آگهی‌ها را استخراج می‌کند و نگه می‌دارد. شما نتایج را بررسی می‌کنید و انتشارشان را تأیید می‌کنید."
                  : "نتایجی که بررسی‌های اعتبار را می‌گذرانند بدون تأیید جداگانه شما منتشر می‌شوند. موارد مشکل‌دار همچنان نیاز به رسیدگی دارند."}
              </span>
            </span>
          </label>
        ))}
        <p
          id={`mode-change-${proposal.id}`}
          role="status"
          className="bg-muted/30 rounded-lg p-3 text-sm"
        >
          {!selection || selection === assignment.review_mode
            ? "این روش ذخیره شده است. برای تغییر، گزینه دیگر را انتخاب و سپس ثبت کنید."
            : selection === "automatic"
              ? "تغییر هنوز ثبت نشده است. پس از ثبت، فقط درخواست‌های تازه مجوز انتشار خودکار می‌گیرند؛ نتایج قبلی همچنان به تأیید شما نیاز دارند. این کار استخراج تازه شروع نمی‌کند."
              : "تغییر هنوز ثبت نشده است. پس از ثبت، انتشار خودکار درخواست‌های در صف و در حال اجرا هم متوقف می‌شود؛ استخراج ادامه دارد و نتایج منتظر تأیید شما می‌مانند."}
        </p>
        <Button
          aria-describedby={`mode-change-${proposal.id}`}
          type="submit"
          disabled={!selection || selection === assignment.review_mode}
        >
          {mutation.isPending ? "در حال ثبت…" : "ثبت روش انتشار"}
        </Button>
      </fieldset>
      {mutation.isSuccess && (
        <p role="status" className="text-sm">
          روش انتشار ذخیره شد.
        </p>
      )}
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
