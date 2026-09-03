import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";

export function ContactPage() {
  const details = useQuery({
    queryKey: ["contact-details"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/system/contact/");
      if (error || !data) throw apiError(error);
      return data;
    },
  });

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <p className="text-primary mb-3 text-sm font-semibold">پشتیبانی انسانی</p>
      <h1 className="text-3xl font-semibold tracking-tight">تماس با ما</h1>
      <p className="text-muted-foreground mt-4 leading-8">
        درخواست شما در مرکز پیام نگهداری می‌شود تا پاسخ اپراتور و وضعیت رسیدگی
        را در یک رشته امن دنبال کنید.
      </p>
      <Button asChild className="mt-7">
        <Link to="/messages/new/support">ایجاد درخواست پشتیبانی</Link>
      </Button>
      <Alert className="mt-6">
        <AlertDescription className="leading-7">
          حذف خودکار حساب در نسخه آلفا در دسترس نیست. برای پیگیری «درخواست حذف
          حساب» از پشتیبانی کمک بگیرید. برای خطرهای مربوط به انتشار شماره، هنگام
          ایجاد درخواست گزینه «حذف فوری اطلاعات تماس عمومی» را انتخاب کنید؛
          اپراتور اطلاعات تماس عمومی را سریع از نمایش خارج می‌کند.
        </AlertDescription>
      </Alert>
      {details.data?.phone || details.data?.address || details.data?.map_url ? (
        <section
          className="mt-8 rounded-xl border p-5"
          aria-labelledby="contact-details-title"
        >
          <h2 id="contact-details-title" className="font-semibold">
            اطلاعات تماس
          </h2>
          {details.data.phone ? (
            <p className="mt-3">
              تلفن:{" "}
              <a
                className="text-primary underline"
                href={`tel:${details.data.phone}`}
              >
                {details.data.phone}
              </a>
            </p>
          ) : null}
          {details.data.address ? (
            <address className="mt-3 not-italic">
              {details.data.address}
            </address>
          ) : null}
          {details.data.map_url ? (
            <a
              className="text-primary mt-3 inline-block underline"
              href={details.data.map_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              مشاهده روی نقشه
            </a>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
