import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionQuery } from "@/features/session/queries";
import { api } from "@/lib/api/client";
import { ApiError, apiError, errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

type ContactMessageInput = components["schemas"]["ContactMessageCreate"];
type ContactMessageKind = components["schemas"]["ContactMessageCreateKindEnum"];

const contactMessageKinds: readonly ContactMessageKind[] = [
  "general",
  "account_deletion",
  "public_contact_removal",
];

function isContactMessageKind(value: string): value is ContactMessageKind {
  return contactMessageKinds.some((kind) => kind === value);
}

function formValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function ContactPage() {
  useQuery(sessionQuery);
  const formRef = useRef<HTMLFormElement>(null);
  const mutation = useMutation({
    mutationFn: async (body: ContactMessageInput) => {
      const { data, error } = await api.POST("/api/v1/contact/messages/", {
        body,
      });
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: () => formRef.current?.reset(),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = formValue(form, "kind");
    if (!isContactMessageKind(kind)) return;
    mutation.mutate({
      name: formValue(form, "name"),
      email: formValue(form, "email"),
      kind,
      message: formValue(form, "message"),
      website: formValue(form, "website"),
    });
  }

  const fieldErrors =
    mutation.error instanceof ApiError ? mutation.error.fields : {};

  function fieldError(name: string, id: string) {
    return fieldErrors[name] ? (
      <p id={id} className="text-destructive text-sm" role="alert">
        {fieldErrors[name]}
      </p>
    ) : null;
  }

  return (
    <main
      id="main-content"
      className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:px-10"
      tabIndex={-1}
    >
      <section>
        <p className="text-primary mb-3 text-sm font-semibold">
          پشتیبانی انسانی
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">تماس با ما</h1>
        <p className="text-muted-foreground mt-4 leading-8">
          پیام شما در ترب‌رنت ذخیره می‌شود تا اپراتور آن را بررسی کند. پاسخ فوری
          یا اعلان ایمیلی تضمین نمی‌شود.
        </p>
        <Alert className="mt-6">
          <AlertDescription className="leading-7">
            حذف خودکار حساب در نسخه آلفا در دسترس نیست. برای خطرهای مربوط به
            انتشار شماره، گزینه «حذف فوری اطلاعات تماس عمومی» را انتخاب کنید؛
            اپراتور اطلاعات تماس عمومی را سریع از نمایش خارج می‌کند.
          </AlertDescription>
        </Alert>
      </section>

      <form
        ref={formRef}
        className="border-border grid gap-5 rounded-xl border p-6"
        onSubmit={submit}
      >
        <Label className="space-y-2">
          <span>نام و نام خانوادگی</span>
          <Input
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={
              fieldErrors.name ? "contact-name-error" : undefined
            }
          />
          {fieldError("name", "contact-name-error")}
        </Label>
        <Label className="space-y-2">
          <span>ایمیل</span>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={
              fieldErrors.email ? "contact-email-error" : undefined
            }
          />
          {fieldError("email", "contact-email-error")}
        </Label>
        <Label className="space-y-2">
          <span>موضوع پیام</span>
          <select
            className="border-input bg-background min-h-11 w-full rounded-md border px-3"
            name="kind"
            required
            defaultValue="general"
            aria-invalid={Boolean(fieldErrors.kind)}
            aria-describedby={
              fieldErrors.kind ? "contact-kind-error" : undefined
            }
          >
            <option value="general">راهنمایی و پرسش</option>
            <option value="account_deletion">درخواست حذف حساب</option>
            <option value="public_contact_removal">
              حذف فوری اطلاعات تماس عمومی
            </option>
          </select>
          {fieldError("kind", "contact-kind-error")}
        </Label>
        <Label className="space-y-2">
          <span>متن پیام</span>
          <textarea
            className="border-input min-h-36 w-full rounded-md border p-3"
            name="message"
            required
            minLength={10}
            maxLength={4000}
            aria-invalid={Boolean(fieldErrors.message)}
            aria-describedby={
              fieldErrors.message ? "contact-message-error" : undefined
            }
          />
          {fieldError("message", "contact-message-error")}
        </Label>
        <label className="absolute -start-[10000px]" aria-hidden="true">
          وب‌سایت
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
        {mutation.isSuccess && (
          <Alert role="status">
            <AlertDescription>{mutation.data.detail}</AlertDescription>
          </Alert>
        )}
        {mutation.isError && Object.keys(fieldErrors).length === 0 && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {errorMessage(
                mutation.error,
                "ثبت پیام ممکن نشد. کمی بعد دوباره تلاش کنید.",
              )}
            </AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "در حال ارسال…" : "ارسال پیام"}
        </Button>
      </form>
    </main>
  );
}
