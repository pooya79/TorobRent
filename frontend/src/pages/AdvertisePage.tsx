import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  CircleDollarSign,
  Clock3,
  EyeOff,
  FileCheck2,
  Globe2,
  MapPinOff,
  PhoneCall,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  submissionSteps,
  type SubmissionStepId,
} from "@/features/submissions/steps";

const proofItems = [
  {
    title: "بررسی اپراتور",
    description: "هر پیشنهاد پیش از انتشار به‌دست اپراتور بررسی می‌شود.",
    icon: FileCheck2,
  },
  {
    title: "موقعیت دقیق منتشر نمی‌شود",
    description: "فقط موقعیت تقریبی برای جست‌وجوی عمومی نمایش داده می‌شود.",
    icon: MapPinOff,
  },
  {
    title: "کنترل انتشار شماره تماس",
    description: "شماره فقط پس از تأیید و با رضایت صریح شما عمومی می‌شود.",
    icon: PhoneCall,
  },
  {
    title: "ادامه از همان مرحله",
    description: "پیش‌نویس ذخیره می‌شود تا مسیر نیمه‌کاره را از سر بگیرید.",
    icon: Clock3,
  },
  {
    title: "تأیید موجود بودن",
    description:
      "با پایان مهلت تأیید یا اعلام ناموجود بودن، آگهی از حالت فعال خارج می‌شود.",
    icon: RefreshCcw,
  },
  {
    title: "ثبت و انتشار رایگان",
    description:
      "برای ارسال پیشنهاد یا انتشار مورد تأییدشده هزینه‌ای پرداخت نمی‌کنید.",
    icon: CircleDollarSign,
  },
] as const;

const persianStepNumbers = ["۱", "۲", "۳", "۴", "۵", "۶", "۷"] as const;

const submissionStepDescriptions: Record<SubmissionStepId, string> = {
  location: "نشانی و موقعیت دقیق را برای بررسی خصوصی ثبت می‌کنید.",
  property_facts: "نوع، متراژ و دیگر واقعیت‌های ملک را وارد می‌کنید.",
  rental_terms: "ودیعه و اجاره ماهانه را به‌صورت یک جفت ثبت می‌کنید.",
  features_description: "وضعیت امکانات شناخته‌شده و توضیحات را کامل می‌کنید.",
  images: "تصاویر را بارگذاری و تصویر اصلی را انتخاب می‌کنید.",
  contact: "شماره پیشنهادی و رضایت انتشار آن را مشخص می‌کنید.",
  review: "اطلاعات را بازبینی و پیشنهاد را برای بررسی ارسال می‌کنید.",
};

const eligibilityItems = [
  {
    title: "مالک",
    description: "مالکیت ملک و اختیار ثبت اطلاعات آن را اعلام می‌کند.",
    icon: Building2,
  },
  {
    title: "نماینده مجاز مالک",
    description:
      "اختیار روشن مالک برای پیشنهاد اطلاعات همان ملک را اعلام می‌کند.",
    icon: UserRoundCheck,
  },
  {
    title: "نماینده منبع",
    description: "مالکیت، مدیریت یا اختیار معرفی منبع بیرونی را اعلام می‌کند.",
    icon: BadgeCheck,
  },
] as const;

const journeyItems = [
  {
    id: "property-journey-title",
    title: "ثبت یک ملک",
    description:
      "برای مالک یا نماینده مجاز مالک که می‌خواهد اطلاعات یک ملک را دستی پیشنهاد دهد.",
    outcome:
      "آگهی مستقیم با شماره تماس تأییدشده‌ای که انتشارش را خودتان پذیرفته‌اید.",
    icon: Building2,
  },
  {
    id: "source-journey-title",
    title: "معرفی وب‌سایت اجاره",
    description:
      "برای نماینده منبع که اختیار معرفی یک منبع بیرونی را دارد و یک پیشنهاد منبع جداگانه می‌فرستد.",
    outcome:
      "آگهی بیرونی با نشانی آگهی اصلی. در نسخه فعلی، کشف شبیه‌سازی‌شده است و خزش زنده یا انتشار خودکار نیست.",
    icon: Globe2,
  },
] as const;

const faqs = [
  {
    question: "چه کسانی می‌توانند اطلاعات ثبت کنند؟",
    answer:
      "مالک می‌تواند ملک خود را ثبت کند. نماینده مجاز مالک باید اختیار روشن برای ثبت آن ملک داشته باشد. نماینده منبع نیز باید مالک، مدیر یا فرد مجاز برای معرفی آن وب‌سایت باشد.",
  },
  {
    question: "ثبت و انتشار هزینه دارد؟",
    answer:
      "خیر. ارسال پیشنهاد، بررسی و انتشار اطلاعات تأییدشده در ترب‌رنت رایگان است.",
  },
  {
    question: "بررسی اپراتور چطور انجام می‌شود؟",
    answer:
      "اپراتور اطلاعات و اختیار اعلام‌شده را می‌سنجد و ممکن است تغییر بخواهد، پیشنهاد را رد کند یا آن را برای انتشار بپذیرد. زمان ثابتی برای پایان بررسی وعده نمی‌دهیم.",
  },
  {
    question: "شماره تلفن من برای همه نمایش داده می‌شود؟",
    answer:
      "خیر. شماره تماس فقط پس از تأیید و وقتی شما صریحا انتشار آن را پذیرفته باشید، مسیر ادامه یک آگهی مستقیم می‌شود.",
  },
  {
    question: "موقعیت دقیق ملک منتشر می‌شود؟",
    answer:
      "خیر. موقعیت دقیق داده‌ای محدود برای بررسی است؛ بازدیدکنندگان فقط موقعیت تقریبی را می‌بینند.",
  },
  {
    question: "چطور یک وب‌سایت اجاره را معرفی کنم؟",
    answer:
      "در شروع مسیر، معرفی وب‌سایت اجاره را انتخاب کنید و مشخصات منبع و اختیار خود را در یک پیشنهاد منبع جداگانه بفرستید.",
  },
  {
    question: "کشف شبیه‌سازی‌شده یعنی چه؟",
    answer:
      "در آلفای فعلی، نتیجه بررسی یک منبع می‌تواند نمونه‌های کنترل‌شده آگهی بیرونی بسازد. این قابلیت، خزش یا کشف زنده وب‌سایت نیست.",
  },
  {
    question: "بعد از ارسال چه اتفاقی می‌افتد؟",
    answer:
      "پیشنهاد در داشبورد شما قابل پیگیری است. اپراتور می‌تواند تغییر بخواهد، آن را رد کند یا تأیید کند؛ فقط مورد تأییدشده منتشر می‌شود.",
  },
] as const;

function StartButton() {
  return (
    <Button asChild className="min-h-12 rounded-full px-6" size="lg">
      <Link to="/dashboard">
        شروع ثبت رایگان
        <ArrowLeft aria-hidden="true" />
      </Link>
    </Button>
  );
}

export function AdvertisePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <section className="relative isolate overflow-hidden border-b">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 [background-image:radial-gradient(circle_at_20%_20%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_34%),linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:auto,3.5rem_3.5rem,3.5rem_3.5rem] opacity-70"
        />
        <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-10 lg:py-28">
          <div className="motion-safe:animate-[fade-in_.45s_ease-out]">
            <p className="text-primary mb-4 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" aria-hidden="true" />
              برای مالک، نماینده مجاز مالک و نماینده منبع
            </p>
            <h1 className="max-w-2xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              ثبت آگهی در ترب‌رنت
            </h1>
            <p className="mt-3 text-xl font-medium sm:text-2xl">
              روشن و مرحله‌به‌مرحله
            </p>
            <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-8">
              یک ملک را برای ساخت آگهی مستقیم پیشنهاد دهید یا یک وب‌سایت اجاره
              را برای بررسی و ساخت آگهی‌های بیرونی معرفی کنید. مسیر شما ذخیره
              می‌شود و هر انتشار به بررسی اپراتور وابسته است.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <StartButton />
              <a
                className="text-muted-foreground hover:text-foreground rounded-md px-2 py-2 text-sm font-medium transition-colors"
                href="#journeys"
              >
                مقایسه دو مسیر
              </a>
            </div>
            <p className="text-muted-foreground mt-5 flex items-center gap-2 text-sm">
              <Check className="text-primary size-4" aria-hidden="true" />
              رایگان؛ با امکان ذخیره پیش‌نویس و ادامه در زمان دیگر
            </p>
          </div>

          <div aria-hidden="true" className="relative mx-auto w-full max-w-xl">
            <div className="bg-card shadow-overlay relative rounded-3xl border p-5 sm:p-7">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">پیشنهاد شما</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    ذخیره امن تا زمان ارسال
                  </p>
                </div>
                <span className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-medium">
                  پیش‌نویس
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="bg-secondary rounded-2xl p-4">
                  <Building2
                    className="text-primary mb-7 size-7"
                    aria-hidden="true"
                  />
                  <p className="font-medium">یک ملک</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    هفت مرحله دستی
                  </p>
                </div>
                <div className="bg-secondary rounded-2xl p-4">
                  <Globe2
                    className="text-primary mb-7 size-7"
                    aria-hidden="true"
                  />
                  <p className="font-medium">یک وب‌سایت</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    پیشنهاد منبع جداگانه
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-2xl border p-4">
                <span className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-full">
                  <ShieldCheck
                    className="text-primary size-5"
                    aria-hidden="true"
                  />
                </span>
                <div>
                  <p className="text-sm font-medium">بررسی پیش از انتشار</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    تأیید خودکار یا تضمین انتشار وجود ندارد
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="safeguards-title"
        className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24"
      >
        <div className="max-w-2xl">
          <p className="text-primary text-sm font-semibold">شفاف از ابتدا</p>
          <h2
            id="safeguards-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            چه چیزی در این مسیر حفظ می‌شود؟
          </h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {proofItems.map(({ title, description, icon: Icon }) => (
            <Card
              className="group hover:border-primary/40 hover:shadow-overlay transition duration-300 motion-safe:hover:-translate-y-1"
              key={title}
            >
              <CardHeader className="pb-3">
                <span className="bg-primary/10 flex size-11 items-center justify-center rounded-xl">
                  <Icon className="text-primary size-5" aria-hidden="true" />
                </span>
                <h3 className="pt-3 font-semibold">{title}</h3>
              </CardHeader>
              <CardContent className="text-muted-foreground leading-7">
                {description}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section
        id="journeys"
        aria-labelledby="journeys-title"
        className="bg-secondary/60 scroll-mt-24 border-y"
      >
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-primary text-sm font-semibold">
              دو نیاز، دو ادامه روشن
            </p>
            <h2
              id="journeys-title"
              className="mt-2 text-3xl font-semibold tracking-tight"
            >
              می‌خواهید چه چیزی معرفی کنید؟
            </h2>
            <p className="text-muted-foreground mt-4 leading-8">
              هر دو گزینه از مسیر شروع مشترک انتخاب می‌شوند، اما داده‌ها و نتیجه
              آن‌ها یکسان نیست.
            </p>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {journeyItems.map(
              ({ id, title, description, outcome, icon: Icon }) => (
                <article
                  aria-labelledby={id}
                  className="bg-card rounded-3xl border p-6 shadow-sm sm:p-8"
                  key={id}
                >
                  <Icon className="text-primary size-9" aria-hidden="true" />
                  <h3 id={id} className="mt-5 text-2xl font-semibold">
                    {title}
                  </h3>
                  <p className="text-muted-foreground mt-3 leading-8">
                    {description}
                  </p>
                  <div className="mt-6 border-t pt-6">
                    <p className="text-sm font-semibold">
                      مسیر ادامه پس از تأیید
                    </p>
                    <p className="text-muted-foreground mt-2 leading-7">
                      {outcome}
                    </p>
                  </div>
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="steps-title"
        className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:px-10 lg:py-24"
      >
        <div>
          <p className="text-primary text-sm font-semibold">
            مسیر دستی ثبت ملک
          </p>
          <h2
            id="steps-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            ثبت یک ملک در هفت مرحله
          </h2>
          <p className="text-muted-foreground mt-4 leading-8">
            پس از اعلام نقش و اختیار خود، این هفت مرحله ذخیره‌شونده را طی
            می‌کنید و می‌توانید میان آن‌ها توقف کنید. این مراحل فقط برای ثبت
            دستی یک ملک است؛ پیشنهاد منبع فرم و فرایند مستقل خود را دارد.
          </p>
        </div>
        <ol
          aria-label="هفت مرحله ثبت ملک"
          className="grid gap-4 sm:grid-cols-2"
        >
          {submissionSteps.map(({ id, label }, index) => (
            <li
              className={
                index === submissionSteps.length - 1
                  ? "sm:col-span-2"
                  : undefined
              }
              key={id}
            >
              <Card className="hover:border-primary/40 h-full transition-colors">
                <CardContent className="flex gap-4 p-5">
                  <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                    {persianStepNumbers[index]}
                  </span>
                  <div>
                    <h3 className="font-semibold">{label}</h3>
                    <p className="text-muted-foreground mt-1 leading-7">
                      {submissionStepDescriptions[id]}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="eligibility-title"
        className="bg-secondary/60 border-y"
      >
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-primary text-sm font-semibold">اختیار روشن</p>
            <h2
              id="eligibility-title"
              className="mt-2 text-3xl font-semibold tracking-tight"
            >
              چه کسی می‌تواند پیشنهاد بفرستد؟
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {eligibilityItems.map(({ title, description, icon: Icon }) => (
              <div className="bg-card rounded-2xl border p-6" key={title}>
                <Icon className="text-primary size-7" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="text-muted-foreground mt-2 leading-7">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="alpha-title"
        className="mx-auto w-full max-w-7xl px-4 pt-16 sm:px-6 lg:px-10 lg:pt-24"
      >
        <div className="border-primary/25 bg-primary/5 flex gap-4 rounded-2xl border p-5 sm:p-6">
          <EyeOff
            className="text-primary mt-1 size-6 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2 id="alpha-title" className="font-semibold">
              مرز نسخه آلفا
            </h2>
            <p className="text-muted-foreground mt-2 leading-7">
              داده‌های کشف منبع در این نسخه شبیه‌سازی‌شده و کنترل‌شده‌اند؛ کشف
              خودکار زنده یا انتشار خودکار نیست. ارسال پیشنهاد نیز به معنی تأیید
              یا تضمین انتشار نیست.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="faq-title"
        className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-10 lg:py-24"
      >
        <div className="text-center">
          <p className="text-primary text-sm font-semibold">پرسش‌های پرتکرار</p>
          <h2
            id="faq-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            پیش از شروع
          </h2>
        </div>
        <div className="mt-8 divide-y rounded-2xl border px-5 sm:px-7">
          {faqs.map(({ question, answer }) => (
            <details className="group py-5" key={question}>
              <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:outline-none">
                {question}
                <span
                  className="text-primary text-xl transition-transform motion-safe:group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="text-muted-foreground pt-4 leading-8">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-10 lg:pb-24">
        <div className="bg-foreground text-background relative overflow-hidden rounded-3xl px-6 py-10 sm:px-10 sm:py-12 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div
            aria-hidden="true"
            className="bg-primary/30 absolute -top-24 -left-20 size-72 rounded-full blur-3xl"
          />
          <div className="relative max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">
              پیشنهادتان را همین حالا شروع کنید
            </h2>
            <p className="mt-3 leading-8 opacity-80">
              مسیر مناسب را انتخاب کنید؛ پیش‌نویس شما ذخیره می‌شود و ارسال نهایی
              برای بررسی اپراتور می‌رود.
            </p>
          </div>
          <div className="relative mt-7 shrink-0 lg:mt-0">
            <StartButton />
          </div>
        </div>
      </section>
    </main>
  );
}
