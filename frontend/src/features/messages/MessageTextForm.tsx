import { useState, type FormEvent } from "react";
import { Send, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function MessageTextForm({
  id,
  initialBody = "",
  editing = false,
  pending,
  error,
  onSubmit,
  onCancel,
  onBodyChange,
}: {
  id: string;
  initialBody?: string;
  editing?: boolean;
  pending: boolean;
  error: boolean;
  onSubmit: (body: string, onSuccess: () => void) => void;
  onCancel?: () => void;
  onBodyChange?: (body: string) => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [sent, setSent] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || pending) return;
    setSent(false);
    onSubmit(body.trim(), () => {
      setBody("");
      onBodyChange?.("");
      setSent(true);
    });
  }
  return (
    <form
      onSubmit={submit}
      className="bg-card grid min-w-0 gap-3 rounded-xl border p-4"
    >
      <Label htmlFor={id}>{editing ? "ویرایش پیام" : "ادامه گفت‌وگو"}</Label>
      <textarea
        id={id}
        name={editing ? "edited_body" : "body"}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          onBodyChange?.(event.target.value);
          setSent(false);
        }}
        disabled={pending}
        required
        maxLength={2000}
        placeholder="پیام خود را بنویسید…"
        className="border-input bg-background min-h-28 w-full resize-y rounded-lg border p-3 text-sm leading-7 break-words"
        aria-describedby={`${id}-help`}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${id}-help`} className="text-muted-foreground text-xs">
          {body.length.toLocaleString("fa-IR")} از ۲٬۰۰۰ نویسه
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onCancel}
            >
              انصراف از ویرایش
            </Button>
          )}
          <Button type="submit" disabled={pending || !body.trim()} size="sm">
            {editing ? (
              <Check aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
            {pending
              ? "در حال ارسال…"
              : editing
                ? "ذخیره ویرایش"
                : "ارسال پیام"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {editing
            ? "ذخیره ویرایش انجام نشد. متن شما حفظ شده است؛ دوباره تلاش کنید."
            : "ارسال پیام انجام نشد. متن شما حفظ شده است؛ دوباره تلاش کنید."}
        </p>
      )}
      {sent && !editing && (
        <p role="status" className="text-primary text-sm">
          پیام شما ارسال شد.
        </p>
      )}
    </form>
  );
}
