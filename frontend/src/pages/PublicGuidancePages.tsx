import type { ReactNode } from "react";
import { Link } from "react-router";

import { AlphaNotice } from "@/components/guidance/AlphaNotice";

function GuidanceLayout({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10"
      tabIndex={-1}
    >
      <header className="mb-10">
        <p className="text-primary mb-3 text-sm font-semibold">{eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-3xl leading-8">
          {intro}
        </p>
      </header>
      <div className="space-y-8 leading-8">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border rounded-xl border p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-muted-foreground mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function GuidePage() {
  return (
    <GuidanceLayout
      eyebrow="راهنمای محصول"
      title="راهنمای ترب‌رنت"
      intro="ترب‌رنت اطلاعات اجاره را یکدست می‌کند تا مقایسه ملک‌ها و آگهی‌های هر منبع روشن‌تر باشد."
    >
      <AlphaNotice />
      <Section title="چطور جست‌وجو کنم؟">
        <p>
          شهر یا محله را انتخاب کنید، فیلترهای اجاره را تنظیم کنید و جزئیات هر
          ملک را ببینید. اطلاعات هر آگهی را با منبع و زمان به‌روزرسانی آن بررسی
          کنید.
        </p>
      </Section>
      <Section title="اگر اطلاعات نادرست بود چه کنم؟">
        <p>
          از صفحه <Link to="/contact">تماس با ما</Link> پیام بفرستید. اپراتور
          پیام را در سامانه بررسی می‌کند؛ ارسال فرم باعث فرستادن ایمیل یا ایجاد
          تیکت در سرویس دیگری نمی‌شود.
        </p>
      </Section>
    </GuidanceLayout>
  );
}

export function AboutPage() {
  return (
    <GuidanceLayout
      eyebrow="شناخت ترب‌رنت"
      title="درباره ترب‌رنت"
      intro="ترب‌رنت مسیر جست‌وجوی ملک‌های مسکونی و تجاری برای اجاره را روشن‌تر می‌کند."
    >
      <Section title="چه کاری انجام می‌دهیم؟">
        <p>
          اطلاعات تأییدشده هر ملک را از آگهی‌های منابع جدا نگه می‌داریم. هر آگهی
          با منبع، شرایط اجاره و زمان آخرین تأیید خود نمایش داده می‌شود تا
          اختلاف منابع پنهان نماند.
        </p>
      </Section>
      <Section title="مرز امروز محصول">
        <p>
          در حال حاضر فقط تهران قابل جست‌وجو است. ترب‌رنت خودش طرف قرارداد اجاره
          نیست و موجود بودن ملک یا درستی همه ادعاهای منبع را تضمین نمی‌کند؛ پیش
          از پرداخت یا توافق، بررسی مستقل ضروری است.
        </p>
      </Section>
      <Section title="اطلاعات نادرست یا ناموجود">
        <p>
          اگر موردی نادرست است، از صفحه
          <Link className="text-primary mx-1 underline" to="/contact">
            تماس با پشتیبانی
          </Link>
          یک درخواست پشتیبانی ثبت کنید.
        </p>
      </Section>
    </GuidanceLayout>
  );
}

export function PrivacyPage() {
  return (
    <GuidanceLayout
      eyebrow="نسخه ۱ — ۱ شهریور ۱۴۰۵"
      title="حریم خصوصی"
      intro="در نسخه آلفا فقط اطلاعات لازم برای حساب، ثبت آگهی، پیام تماس و رسیدگی اپراتور نگهداری می‌شود."
    >
      <Section title="پیام‌های تماس">
        <p>
          نام، ایمیل، متن پیام، وضعیت رسیدگی و یادداشت کوتاه اپراتور برای پیگیری
          نگهداری می‌شوند. این پیام‌ها برای اعلان به سرویس ایمیل یا میز کمک
          فرستاده نمی‌شوند.
        </p>
      </Section>
      <Section title="حذف اطلاعات عمومی و حساب">
        <p>
          اگر انتشار شماره یا اطلاعات تماس برای شما خطر یا نگرانی ایجاد کرده
          است، آن را در فرم تماس مشخص کنید؛ اطلاعات تماس عمومی را در نخستین فرصت
          از نمایش خارج می‌کنیم. حذف خودکار حساب هنوز ارائه نمی‌شود و درخواست
          حذف حساب را اپراتور بررسی می‌کند.
        </p>
      </Section>
    </GuidanceLayout>
  );
}

export function TermsPage() {
  return (
    <GuidanceLayout
      eyebrow="نسخه ۱ — ۱ شهریور ۱۴۰۵"
      title="شرایط استفاده"
      intro="استفاده از نسخه آلفا به معنی پذیرش محدودیت‌های به‌روز بودن اطلاعات و مسئولیت بررسی مستقل اطلاعات است."
    >
      <AlphaNotice />
      <Section title="اعتبار اطلاعات">
        <p>
          نتیجه‌ها تضمین موجود بودن ملک نیستند. پیش از هر پرداخت، بازدید یا
          توافق، هویت طرف مقابل و درستی شرایط را مستقل بررسی کنید.
        </p>
      </Section>
      <Section title="ثبت اطلاعات">
        <p>
          ثبت‌کننده باید مالک باشد یا اختیار روشن مالک برای ثبت اطلاعات را داشته
          باشد. شماره تماس فقط با رضایت صریح ثبت‌کننده منتشر می‌شود.
        </p>
      </Section>
    </GuidanceLayout>
  );
}
