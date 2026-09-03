import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";

type IntakeKind = "general" | "account_deletion" | "public_contact_removal";

function value(form: FormData, name: string) {
  const item = form.get(name);
  return typeof item === "string" ? item : "";
}

export function SupportComposerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<IntakeKind>("general");
  const mutation = useMutation({
    mutationFn: async (body: {
      intake_kind: IntakeKind;
      subject: string;
      message: string;
    }) => {
      const { data, error } = await api.POST(
        "/api/v1/messages/support-requests/",
        { body },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void navigate(created.href);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      intake_kind: kind,
      subject: value(form, "subject"),
      message: value(form, "message"),
    });
  }

  return (
    <main
      id="main-content"
      dir="rtl"
      className="mx-auto w-full max-w-2xl px-4 py-10"
      tabIndex={-1}
    >
      <p className="text-primary mb-2 text-sm font-semibold">مرکز پیام</p>
      <h1 className="text-3xl font-semibold">درخواست پشتیبانی جدید</h1>
      <p className="text-muted-foreground mt-3 leading-7">
        هویت و راه تماس از حساب تأییدشده شما دریافت می‌شود.
      </p>
      <form className="mt-7 grid gap-5 rounded-xl border p-6" onSubmit={submit}>
        <Label className="space-y-2">
          <span>نوع درخواست</span>
          <select
            className="border-input bg-background min-h-11 w-full rounded-md border px-3"
            name="intake_kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as IntakeKind)}
          >
            <option value="general">راهنمایی و پرسش</option>
            <option value="account_deletion">درخواست حذف حساب</option>
            <option value="public_contact_removal">
              حذف فوری اطلاعات تماس عمومی
            </option>
          </select>
        </Label>
        <Label className="space-y-2">
          <span>موضوع کوتاه</span>
          <Input name="subject" required maxLength={120} />
        </Label>
        <Label className="space-y-2">
          <span>پیام نخست</span>
          <textarea
            className="border-input min-h-40 rounded-md border p-3"
            name="message"
            required
            maxLength={2000}
          />
        </Label>
        {mutation.isError ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {errorMessage(
                mutation.error,
                "ثبت درخواست ممکن نشد. دوباره تلاش کنید.",
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending ? "در حال ثبت…" : "ثبت درخواست پشتیبانی"}
        </Button>
      </form>
    </main>
  );
}

export default SupportComposerPage;
