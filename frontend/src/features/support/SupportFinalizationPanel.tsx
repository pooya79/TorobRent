import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type {
  SupportReopenInput,
  SupportRequest,
  SupportResolutionInput,
} from "@/features/support/queries";

const fieldClass =
  "border-input bg-background mt-1 min-h-24 w-full rounded-md border px-3 py-2 text-sm";
const selectClass =
  "border-input bg-background mt-1 h-11 w-full rounded-md border px-3";

export function SupportFinalizationPanel({
  canRecord,
  isPending,
  onReopen,
  onResolve,
  supportRequest,
}: {
  canRecord: boolean;
  isPending: boolean;
  onReopen: (input: SupportReopenInput) => void;
  onResolve: (input: SupportResolutionInput) => void;
  supportRequest: SupportRequest;
}) {
  const [resolutionCategory, setResolutionCategory] = useState(
    "answered_externally",
  );
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  function submitResolution(event: FormEvent) {
    event.preventDefault();
    onResolve({
      category: resolutionCategory as SupportResolutionInput["category"],
      summary: resolutionSummary,
    });
  }

  function submitReopen(event: FormEvent) {
    event.preventDefault();
    onReopen({ reason: reopenReason });
  }

  return (
    <>
      {canRecord && (
        <form
          className="border-border rounded-lg border p-4"
          onSubmit={submitResolution}
        >
          <h3 className="font-semibold">نتیجه نهایی</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Label>
              نتیجه نهایی
              <select
                className={selectClass}
                value={resolutionCategory}
                onChange={(event) => setResolutionCategory(event.target.value)}
              >
                <option value="answered_externally">
                  پاسخ بیرون از TorobRent
                </option>
                <option value="action_completed">اقدام تکمیل شد</option>
                <option value="duplicate">تکراری</option>
                <option value="spam">هرزنامه</option>
                <option value="no_action_required">بدون اقدام لازم</option>
              </select>
            </Label>
            <Label>
              خلاصه داخلی نتیجه
              <textarea
                className={fieldClass}
                maxLength={1000}
                required
                value={resolutionSummary}
                onChange={(event) => setResolutionSummary(event.target.value)}
              />
            </Label>
          </div>
          <Button className="mt-3" disabled={isPending} type="submit">
            ثبت نتیجه و بستن
          </Button>
        </form>
      )}

      {supportRequest.status === "resolved" &&
        supportRequest.resolution_category && (
          <div className="bg-muted rounded-lg p-4 text-sm">
            <h3 className="font-semibold">نتیجه ثبت‌شده</h3>
            <p className="mt-2">{supportRequest.resolution_category}</p>
            <p className="mt-1 whitespace-pre-wrap">
              {supportRequest.resolution_summary}
            </p>
            {supportRequest.resolved_at && (
              <time
                className="text-muted-foreground mt-2 block text-xs"
                dateTime={supportRequest.resolved_at}
              >
                {new Date(supportRequest.resolved_at).toLocaleString("fa-IR")}
              </time>
            )}
          </div>
        )}

      {supportRequest.status === "resolved" && (
        <form
          className="border-border rounded-lg border p-4"
          onSubmit={submitReopen}
        >
          <h3 className="font-semibold">بازگشایی</h3>
          <Label className="mt-3 block">
            دلیل بازگشایی
            <textarea
              className={fieldClass}
              maxLength={1000}
              required
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
            />
          </Label>
          <Button
            className="mt-3"
            disabled={isPending}
            type="submit"
            variant="outline"
          >
            بازگشایی درخواست
          </Button>
        </form>
      )}
    </>
  );
}
