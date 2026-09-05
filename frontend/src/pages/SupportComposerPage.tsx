import { AccountWorkspace } from "@/features/account/AccountWorkspace";
import { ArrowRight, Headphones, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

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
  const [message, setMessage] = useState("");
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
      subject: value(form, "subject").trim(),
      message: message.trim(),
    });
  }

  return (
    <AccountWorkspace>
      <Link
        to="/messages"
        className="text-muted-foreground mb-5 inline-flex min-h-11 items-center gap-2 text-sm"
      >
        <ArrowRight className="size-4" aria-hidden="true" />
        بازگشت به پیام‌ها
      </Link>
      <p className="text-primary mb-2 text-sm font-semibold">مرکز پیام</p>
      <h1 className="text-3xl font-semibold">درخواست پشتیبانی جدید</h1>
      <p className="text-muted-foreground mt-3 leading-7">
        هویت و راه تماس از حساب تأییدشده شما دریافت می‌شود.
      </p>
      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <form
          className="bg-card grid min-w-0 gap-5 rounded-2xl border p-5 sm:p-6"
          onSubmit={submit}
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Headphones className="size-5" aria-hidden="true" />
            شرح درخواست
          </h2>
          <fieldset
            disabled={mutation.isPending}
            className="grid min-w-0 gap-5"
          >
            <div className="space-y-2">
              <Label htmlFor="support-kind">نوع درخواست</Label>
              <select
                className="border-input bg-background min-h-11 w-full rounded-md border px-3"
                id="support-kind"
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-subject">موضوع کوتاه</Label>
              <Input
                id="support-subject"
                name="subject"
                required
                pattern=".*\S.*"
                maxLength={120}
                placeholder="مثلاً مشکل در ویرایش آگهی"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-message">پیام نخست</Label>
              <textarea
                className="border-input bg-background min-h-48 w-full resize-y rounded-lg border p-3 text-sm leading-7"
                id="support-message"
                placeholder="موضوع و جزئیات لازم برای پیگیری را بنویسید…"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                aria-describedby="support-message-help"
                name="message"
                required
                maxLength={2000}
              />
              <p
                id="support-message-help"
                className="text-muted-foreground text-xs"
              >
                {message.length.toLocaleString("fa-IR")} از ۲٬۰۰۰ نویسه
              </p>
            </div>
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
            <Button
              disabled={mutation.isPending || !message.trim()}
              type="submit"
            >
              {mutation.isPending ? "در حال ثبت…" : "ثبت درخواست پشتیبانی"}
            </Button>
          </fieldset>
        </form>
        <aside className="bg-muted/60 rounded-2xl p-6">
          <ShieldCheck
            className="text-primary mb-4 size-7"
            aria-hidden="true"
          />
          <h2 className="font-semibold">برای پیگیری بهتر</h2>
          <p className="text-muted-foreground mt-3 text-sm leading-7">
            {kind === "general"
              ? "اگر درخواست به یک آگهی مربوط است، نام یا پیوند آن را در متن بنویسید. پاسخ پشتیبانی در همین مرکز پیام نمایش داده می‌شود."
              : kind === "account_deletion"
                ? "درخواست حذف حساب برای بررسی به پشتیبانی ارسال می‌شود. ارسال این فرم به‌تنهایی حساب شما را حذف نمی‌کند."
                : "محل نمایش اطلاعات تماسی را که می‌خواهید حذف شود مشخص کنید تا پشتیبانی آن را بررسی کند."}
          </p>
          <p className="text-muted-foreground mt-4 border-t pt-4 text-sm leading-7">
            گذرواژه و کد تأیید حساب خود را در پیام ننویسید.
          </p>
        </aside>
      </div>
    </AccountWorkspace>
  );
}

export default SupportComposerPage;
