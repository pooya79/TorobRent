import { useEffect, useRef, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  Code2,
  Globe2,
  LifeBuoy,
  Search,
  Send,
} from "lucide-react";

import { AlphaNotice } from "@/components/guidance/AlphaNotice";
import { Button } from "@/components/ui/button";

const topics = [
  { id: "start", title: "از کجا شروع کنم؟", icon: BookOpen },
  { id: "website", title: "معرفی وب‌سایت", icon: Globe2 },
  { id: "structured-data", title: "آماده‌سازی اطلاعات سایت", icon: Code2 },
  { id: "single-property", title: "ثبت یک ملک", icon: Building2 },
  { id: "search", title: "جست‌وجو و مقایسه", icon: Search },
  { id: "follow-up", title: "پیگیری و رفع مشکل", icon: LifeBuoy },
] as const;

function Section({
  activeTopic,
  id,
  title,
  intro,
  children,
}: {
  activeTopic: string;
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  if (activeTopic !== id) return null;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
      className="bg-card scroll-mt-28 rounded-2xl border p-5 sm:p-8"
    >
      <h2 id={`${id}-heading`} className="text-xl font-semibold sm:text-2xl">
        {title}
      </h2>
      <p className="text-muted-foreground mt-3 leading-8">{intro}</p>
      <div className="mt-6 space-y-6 leading-8">{children}</div>
    </section>
  );
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="marker:text-primary list-disc space-y-2 ps-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  const className =
    "focus-visible:outline-ring inline-flex min-h-11 items-center gap-2 rounded-md font-medium underline underline-offset-4 focus-visible:outline-2";
  const content = (
    <>
      {children}
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
    </>
  );
  if (to.startsWith("#"))
    return (
      <a href={to} className={className}>
        {content}
      </a>
    );
  return (
    <Link to={to} className={className}>
      {content}
    </Link>
  );
}

const dataFields = [
  [
    "عنوان و توضیح",
    "name · description",
    "عنوان مشخص و توضیح واقعی همان ملک؛ بدون متن تبلیغاتی نامرتبط.",
  ],
  [
    "نوع ملک",
    "@type · accommodationCategory",
    "نوع مناسب مانند Apartment یا House را انتخاب کنید؛ مسکونی یا تجاری بودن را روشن بنویسید.",
  ],
  [
    "متراژ و اتاق خواب",
    "floorSize · numberOfBedrooms",
    "متراژ با واحد مترمربع و تعداد اتاق خواب؛ تعداد کل اتاق‌ها با اتاق خواب یکسان نیست.",
  ],
  [
    "محدوده ملک",
    "address · addressLocality · addressRegion",
    "شهر، منطقه شهرداری و محله را جدا و روشن بنویسید. آدرس ساخت‌یافته باید با متن صفحه هماهنگ باشد؛ اطلاعات خصوصی را صرفاً برای پردازش منتشر نکنید.",
  ],
  [
    "موقعیت جغرافیایی",
    "geo · latitude · longitude",
    "مختصات فقط در صورت دسترسی مجاز و صحت اطلاعات؛ نمایش عمومی ترب‌رنت تقریبی است. مختصات دقیق را صرفاً برای معرفی سایت عمومی نکنید.",
  ],
  [
    "پارکینگ، آسانسور و انباری",
    "amenityFeature · name · value",
    "برای هر امکان یک LocationFeatureSpecification با نام روشن و وضعیت واقعی بنویسید. این الگوی استاندارد توصیه می‌شود؛ فعلاً نام و وضعیت را در متن صفحه هم درج کنید.",
  ],
  [
    "بالکن و مبله بودن",
    "amenityFeature · name · value",
    "هر امکان جداگانه باشد. دارد و ندارد را صریح مشخص کنید؛ نامعلوم را به معنی ندارد ثبت نکنید. متن قابل مشاهده هم لازم است.",
  ],
  [
    "گرمایش و سرمایش",
    "amenityFeature · name · value",
    "نوع سیستم را با نام واضح مانند پکیج یا کولر آبی در متن صفحه بنویسید؛ توصیف ساخت‌یافته مکمل آن است.",
  ],
  [
    "سال ساخت و طبقه",
    "yearBuilt · floorLevel",
    "سال ساخت با تقویم مشخص و طبقه با توضیح همکف یا زیرزمین در متن صفحه درج شود. خواندن خودکار این کلیدهای استاندارد در همه قالب‌ها تضمین نمی‌شود.",
  ],
  [
    "تعداد طبقات و واحد در طبقه",
    "additionalProperty · name · value",
    "این دو مشخصه را جداگانه و با برچسب فارسی در صفحه درج کنید. ویژگی تکمیلی ساخت‌یافته به‌تنهایی به معنی پشتیبانی خودکار نیست.",
  ],
  [
    "ودیعه و اجاره ماهانه",
    "offers · priceSpecification · price · priceCurrency",
    "هر مبلغ با عنوان مستقل، واحد پول و دوره پرداخت مشخص باشد. یک قیمت کلی برای هر دو مبلغ کافی نیست؛ مقادیر را در متن صفحه نیز بنویسید.",
  ],
  [
    "قابل مذاکره و قابل تبدیل",
    "description",
    "توافق‌پذیری و امکان تبدیل ودیعه و اجاره را جدا توضیح دهید. از مبلغ صفر یا نبود مبلغ برای بیان این شرایط استفاده نکنید؛ نمایش نهایی به بررسی منبع بستگی دارد.",
  ],
  [
    "تصاویر و نشانی",
    "image · url",
    "تصاویر مجاز همان ملک و نشانی پایدار صفحه اصلی آگهی.",
  ],
  [
    "زمان انتشار",
    "datePublished / datePosted",
    "متناسب با نوع داده، تاریخ واقعی انتشار را درج کنید و اطلاعات قدیمی را به‌روز نگه دارید.",
  ],
  [
    "شناسه و موجود بودن آگهی",
    "identifier · url · description",
    "شناسه و لینک پایدار، وضعیت فعلی موجود بودن و تاریخ واقعی تأیید آن را روشن نگه دارید. تاریخ انتشار با تاریخ تأیید موجود بودن یکسان نیست؛ داده ساخت‌یافته به‌تنهایی وضعیت ترب‌رنت را تغییر نمی‌دهد.",
  ],
];

export function GuidePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTopic =
    topics.find((topic) => topic.id === searchParams.get("topic"))?.id ??
    "start";
  const topicIndex = topics.findIndex((topic) => topic.id === activeTopic);
  const previous = topics[topicIndex - 1];
  const next = topics[topicIndex + 1];
  const previousTopic = useRef(activeTopic);
  useEffect(() => {
    if (previousTopic.current === activeTopic) return;
    previousTopic.current = activeTopic;
    const section = document.getElementById(activeTopic);
    section?.focus({ preventScroll: true });
    section?.scrollIntoView?.({ behavior: "instant", block: "start" });
  }, [activeTopic]);
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10"
    >
      <header className="mb-10 max-w-3xl">
        <p className="text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="size-4" aria-hidden="true" />
          مرکز راهنما
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          راهنمای ترب‌رنت
        </h1>
        <p className="text-muted-foreground mt-4 text-lg leading-8">
          از پیدا کردن ملک تا معرفی وب‌سایت؛ مسیر خود را انتخاب کنید و قدم بعدی
          را بشناسید.
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          برای مستأجرها، مالکان، نمایندگان و مدیران وب‌سایت‌های اجاره
        </p>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <aside className="min-w-0 lg:sticky lg:top-28">
          <nav
            aria-label="موضوعات راهنما"
            className="bg-muted/40 rounded-2xl border p-3"
          >
            <label
              htmlFor="guide-topic"
              className="block px-3 py-2 text-sm font-semibold lg:hidden"
            >
              موضوع راهنما
            </label>
            <select
              id="guide-topic"
              value={activeTopic}
              onChange={(event) =>
                setSearchParams({ topic: event.target.value })
              }
              className="bg-background min-h-12 w-full rounded-xl border px-3 text-sm lg:hidden"
            >
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </select>
            <p className="hidden px-3 py-2 text-sm font-semibold lg:block">
              در این راهنما
            </p>
            <ul className="hidden gap-1 lg:grid">
              {topics.map(({ id, title, icon: Icon }, index) => (
                <li key={id}>
                  <Link
                    to={`/guide?topic=${id}`}
                    aria-current={activeTopic === id ? "page" : undefined}
                    className="hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-primary focus-visible:outline-ring flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm focus-visible:outline-2 aria-[current=page]:font-semibold"
                  >
                    <Icon
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span>{title}</span>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground ms-auto text-xs"
                    >
                      {(index + 1).toLocaleString("fa-IR")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="text-muted-foreground mt-4 hidden px-4 text-sm leading-7 lg:block">
            پاسخ خود را پیدا نکردید؟
            <br />
            <ActionLink to="/contact">تماس با پشتیبانی</ActionLink>
          </div>
        </aside>
        <div className="min-w-0 space-y-6">
          <Section
            activeTopic={activeTopic}
            id="start"
            title="از کجا شروع کنم؟"
            intro="ترب‌رنت اطلاعات ملک‌ها و آگهی‌های منابع مختلف را کنار هم قرار می‌دهد. در حال حاضر جست‌وجو برای ملک‌های مسکونی و تجاری تهران در دسترس است."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="bg-muted/50 rounded-xl p-5">
                <Building2
                  aria-hidden="true"
                  className="text-primary mb-3 size-6"
                />
                <h3 className="font-semibold">یک ملک برای اجاره دارم</h3>
                <p className="text-muted-foreground mt-2 text-sm">
                  اگر مالک یا نماینده مجاز مالک هستید، مشخصات، شرایط اجاره و
                  تصاویر را در فرم ثبت ملک وارد کنید.
                </p>
                <ActionLink to="/guide?topic=single-property">
                  راهنمای ثبت ملک
                </ActionLink>
              </div>
              <div className="bg-muted/50 rounded-xl p-5">
                <Globe2
                  aria-hidden="true"
                  className="text-primary mb-3 size-6"
                />
                <h3 className="font-semibold">وب‌سایت آگهی اجاره دارم</h3>
                <p className="text-muted-foreground mt-2 text-sm">
                  اگر مالک، مدیر یا نماینده مجاز سایت هستید، سایت را برای بررسی
                  و دریافت اطلاعات آگهی‌ها معرفی کنید.
                </p>
                <ActionLink to="/guide?topic=website">
                  راهنمای معرفی سایت
                </ActionLink>
              </div>
            </div>
            <p>
              برای ارسال اطلاعات، وارد حساب شوید و مراحل تأیید شماره همراه را
              تکمیل کنید. برای جست‌وجوی عمومی نیازی به حساب ندارید.
            </p>
            <Button asChild>
              <Link to="/submitter/get-started">
                <Send aria-hidden="true" />
                شروع ثبت ملک یا معرفی سایت
              </Link>
            </Button>
            <AlphaNotice />
          </Section>
          <Section
            activeTopic={activeTopic}
            id="website"
            title="معرفی وب‌سایت اجاره"
            intro="وب‌سایت را فقط زمانی معرفی کنید که اختیار این کار را دارید. هر حساب ارسال‌کننده یک وب‌سایت جاری دارد؛ پرونده موجود را از داشبورد ادامه دهید."
          >
            <div>
              <h3 className="mb-3 font-semibold">چه نشانی‌ای بفرستم؟</h3>
              <Checklist
                items={[
                  "نشانی کامل و عمومی سایت را وارد کنید؛ ترجیحاً با https:// و به صفحه فهرست اجاره‌های تهران یا یک آگهی اجاره قابل مشاهده برسد.",
                  "صفحه باید بدون ورود به حساب باز شود. نشانی پنل مدیریت، لینک موقت، لینک دارای رمز یا اطلاعات نشست نفرستید.",
                  "نشانی را مستقیم از سایت خود کپی کنید؛ از لینک کوتاه‌شده یا واسطه پرهیز کنید. www و زیردامنه‌ها را دقیق وارد کنید.",
                  "نام سایت، نقش خود و برآورد تعداد آگهی‌ها را بنویسید. اگر نقشه سایت دارید، نشانی آن را در فیلد جداگانه و روی همان میزبان وارد کنید.",
                  "در یادداشت، بخش اجاره‌های تهران و تفاوت قالب صفحات را توضیح دهید تا تیم بررسی بهتر سایت را بشناسد.",
                ]}
              />
            </div>
            <div className="bg-muted/50 rounded-xl p-4">
              <p className="text-sm font-medium">
                نمونه ساختار نشانی — فقط برای توضیح
              </p>
              <p dir="ltr" className="mt-2 font-mono text-sm break-all">
                https://example.com/tehran/rent
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                این نشانی نمونه را با نشانی واقعی بخش اجاره سایت خود جایگزین
                کنید.
              </p>
            </div>
            <div>
              <h3 className="mb-3 font-semibold">
                بعد از ارسال چه اتفاقی می‌افتد؟
              </h3>
              <ol className="marker:text-primary list-decimal space-y-2 ps-5 marker:font-semibold">
                <li>تیم بررسی، نشانی و درخواست معرفی سایت را بررسی می‌کند.</li>
                <li>
                  پس از تأیید نشانی، نمونه‌هایی از صفحات برای خوانایی اطلاعات
                  بررسی می‌شوند.
                </li>
                <li>
                  در صورت نیاز، توضیح یا اصلاح اطلاعات از شما خواسته می‌شود.
                </li>
                <li>
                  پس از تأیید منبع، می‌توانید از داشبورد درخواست پردازش
                  نشانی‌های همان سایت را ثبت و نتیجه را پیگیری کنید.
                </li>
              </ol>
            </div>
            <p className="text-muted-foreground text-sm">
              ارسال نشانی به معنی انتشار فوری، بررسی همه صفحات یا به‌روزرسانی
              لحظه‌ای نیست. نتیجه هر درخواست و موارد نیازمند پیگیری را در پرونده
              سایت ببینید.
            </p>
            <ActionLink to="/source-proposal">
              معرفی یا ادامه پرونده وب‌سایت
            </ActionLink>
          </Section>
          <Section
            activeTopic={activeTopic}
            id="structured-data"
            title="سایت را برای خواندن اطلاعات آماده کنید"
            intro="بهترین گزینه، اطلاعات ساخت‌یافته مطابق استانداردهای وب معنایی است: مشخصات ملک برای انسان روشن باشد و نسخه قابل‌خواندن برای سامانه‌ها هم با همان اطلاعات هماهنگ بماند."
          >
            <div className="border-primary bg-muted/50 rounded-xl border-s-4 p-5">
              <h3 className="font-semibold">
                داده ساخت‌یافته توصیه می‌شود؛ شرط تضمین انتشار نیست
              </h3>
              <p className="mt-2">
                استفاده از JSON-LD و Schema.org به توصیف دقیق ملک کمک می‌کند.
                متاتگ‌ها و Open Graph هم برای عنوان، توضیح و تصویر مفیدند، اما
                به‌تنهایی مشخصات کامل ملک و شرایط اجاره را پوشش نمی‌دهند.
              </p>
            </div>
            <p>
              ترب‌رنت اطلاعات قابل‌خواندن صفحات را بررسی و یکدست می‌کند. اگر
              داده ساخت‌یافته کافی نباشد، اطلاعات روشن داخل صفحه هم می‌تواند به
              بررسی کمک کند. موارد ناقص یا متعارض ممکن است به پیگیری تیم بررسی
              نیاز داشته باشند.
            </p>
            <div className="rounded-xl border p-4 sm:p-5">
              <h3 className="font-semibold">
                چه اطلاعاتی از سایت شما قابل بررسی است؟
              </h3>
              <p className="mt-3">
                علاوه بر عنوان و مبالغ، شهر، منطقه، محله، متراژ، اتاق خواب، سال
                ساخت، طبقه، تعداد طبقات و واحدهای هر طبقه را بنویسید. پارکینگ،
                آسانسور، انباری، بالکن، مبله بودن و نوع گرمایش و سرمایش را هم
                جدا مشخص کنید.
              </p>
              <p className="text-muted-foreground mt-3 text-sm">
                در نسخه فعلی، اطلاعات مکانی و برخی مشخصات از داده ساخت‌یافته
                قابل خواندن‌اند. برای امکانات و جزئیات ساختمان، متن روشن و
                برچسب‌دار صفحه را هم حفظ کنید؛ پشتیبانی خودکار از amenityFeature
                و همه کلیدهای تکمیلی هنوز کامل نیست.
              </p>
              <p className="mt-3 text-sm">
                اطلاعات نامعلوم را حدس نزنید. وجود یک مشخصه در صفحه جزئیات
                ترب‌رنت به معنی دریافت قطعی آن از هر سایت نیست؛ نتیجه پردازش و
                بررسی، تعیین‌کننده است.
              </p>
            </div>
            <details className="rounded-xl border p-4 sm:p-5">
              <summary className="min-h-11 cursor-pointer font-semibold">
                چک‌لیست برای مدیر فنی سایت
              </summary>
              <p className="text-muted-foreground mb-4 text-sm">
                این‌ها نمونه واژگان استاندارد هستند؛ انتخاب نوع و جایگاه هر فیلد
                باید با محتوای واقعی صفحه هماهنگ باشد و به معنی پشتیبانی تضمینی
                از هر قالب نیست.
              </p>
              <dl className="space-y-4 sm:hidden">
                {dataFields.map(([label, field, tip]) => (
                  <div
                    key={label}
                    className="bg-muted/40 rounded-xl border p-4"
                  >
                    <dt className="font-medium">{label}</dt>
                    <dd className="mt-2">
                      <code
                        dir="ltr"
                        className="inline-block text-xs break-words"
                      >
                        {field}
                      </code>
                    </dd>
                    <dd className="text-muted-foreground mt-2 text-sm">
                      {tip}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="hidden overflow-x-auto rounded-lg border sm:block">
                <table className="w-full text-start text-sm">
                  <caption className="sr-only">
                    اطلاعات پیشنهادی برای داده ساخت‌یافته ملک
                  </caption>
                  <thead className="bg-muted">
                    <tr>
                      <th scope="col" className="p-3 text-start">
                        اطلاعات
                      </th>
                      <th scope="col" className="p-3 text-start">
                        نمونه فیلد
                      </th>
                      <th scope="col" className="p-3 text-start">
                        نکته
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataFields.map(([label, field, tip]) => (
                      <tr key={label} className="border-t">
                        <th scope="row" className="p-3 text-start font-medium">
                          {label}
                        </th>
                        <td className="p-3">
                          <code dir="ltr" className="inline-block text-xs">
                            {field}
                          </code>
                        </td>
                        <td className="text-muted-foreground min-w-40 p-3">
                          {tip}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 font-medium">
                ودیعه و اجاره ماهانه را جدا و با واحد پول روشن بنویسید.
              </p>
              <p className="text-muted-foreground text-sm">
                مبلغ بدون واحد یا یک عدد مشترک برای ودیعه و اجاره مبهم است. در
                داده ساخت‌یافته هم نوع مبلغ، ارز و دوره پرداخت را مشخص کنید؛ اگر
                از کد IRR استفاده می‌کنید، عدد باید به ریال باشد. مبلغ نامعلوم
                را صفر ننویسید.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 text-sm">
                <a
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href="https://schema.org/LocationFeatureSpecification"
                >
                  مرجع توصیف امکانات
                </a>
                <a
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href="https://schema.org/Apartment"
                >
                  مرجع مشخصات ملک در Schema.org
                </a>
                <a
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href="https://schema.org/RealEstateListing"
                >
                  مرجع آگهی ملک
                </a>
                <a
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  href="https://ogp.me/"
                >
                  مرجع Open Graph
                </a>
              </div>
            </details>
            <div>
              <h3 className="mb-3 font-semibold">حتی بدون داده ساخت‌یافته</h3>
              <Checklist
                items={[
                  "برای هر آگهی یک صفحه و نشانی پایدار داشته باشید؛ مشخصات ملک را از آگهی‌های پیشنهادی کنار صفحه جدا کنید.",
                  "متراژ، اتاق خواب، محله، ودیعه و اجاره را با برچسب واضح و به صورت متن بنویسید؛ قرار دادن همه اطلاعات داخل تصویر کافی نیست.",
                  "برای امکانات، برچسب و مقدار مستقل بنویسید؛ مثلاً «پارکینگ: دارد»، «آسانسور: ندارد» و «سرمایش: کولر آبی». به آیکون بدون متن اکتفا نکنید.",
                  "داده پنهان صفحه، عنوان و متن قابل مشاهده را همزمان به‌روز کنید تا درباره یک ملک اطلاعات متفاوتی ندهند.",
                  "ناموجود شدن ملک و تغییر شرایط اجاره را در سایت مشخص کنید و پس از تغییر مهم قالب صفحات به تیم بررسی اطلاع دهید.",
                ]}
              />
            </div>
          </Section>
          <Section
            activeTopic={activeTopic}
            id="single-property"
            title="ثبت یک ملک، قدم به قدم"
            intro="این مسیر برای مالک یا نماینده مجاز مالک است. اطلاعات را از روی وضعیت واقعی ملک آماده کنید و قبل از ارسال، پیش‌نمایش را بخوانید."
          >
            <ol className="marker:text-primary list-decimal space-y-4 ps-5 marker:font-semibold">
              <li>
                <strong>نشانی ملک:</strong> شهر، محله و موقعیت را دقیق وارد
                کنید. موقعیت عمومی به صورت تقریبی نمایش داده می‌شود.
              </li>
              <li>
                <strong>مشخصات ملک:</strong> نوع مسکونی یا تجاری، متراژ و مشخصات
                مرتبط مانند تعداد اتاق خواب، سال ساخت، طبقه، تعداد طبقات و واحد
                در طبقه را تکمیل کنید.
              </li>
              <li>
                <strong>شرایط اجاره:</strong> ودیعه و اجاره ماهانه را جداگانه و
                به تومان وارد کنید. مبلغ صفر را فقط زمانی بزنید که واقعاً آن بخش
                از مبلغ صفر است.
              </li>
              <li>
                <strong>امکانات و توضیحات:</strong> برای امکانات، «دارد»،
                «ندارد» و «نامشخص» را از هم جدا کنید. پارکینگ، آسانسور، انباری،
                بالکن، مبله بودن و نوع گرمایش و سرمایش را بررسی کنید. شماره تماس
                و اطلاعات خصوصی را داخل توضیحات ننویسید.
              </li>
              <li>
                <strong>تصاویر:</strong> عکس‌های روشن و واقعی با اجازه انتشار
                بارگذاری کنید؛ مدارک، چهره افراد و اطلاعات خصوصی در تصویر نباشد.
              </li>
              <li>
                <strong>اطلاعات تماس:</strong> شماره تأییدشده و رضایت انتشار آن
                را بررسی کنید. تأیید حساب با اجازه نمایش عمومی شماره یکسان نیست.
              </li>
              <li>
                <strong>بازبینی و ارسال:</strong> نشانی، مبالغ، عکس‌ها و نقش خود
                را دوباره بخوانید؛ سپس پیشنهاد را برای بررسی ارسال کنید.
              </li>
            </ol>
            <p className="bg-muted/50 rounded-xl p-4 text-sm">
              می‌توانید پیش‌نویس را از داشبورد ادامه دهید. پس از ارسال، وضعیت و
              دلیل تصمیم را همان‌جا ببینید؛ اگر اصلاح خواسته شد، موارد مشخص‌شده
              را تکمیل و دوباره ارسال کنید.
            </p>
            <ActionLink to="/add-submission">
              شروع یا ادامه ثبت یک ملک
            </ActionLink>
          </Section>
          <Section
            activeTopic={activeTopic}
            id="search"
            title="چطور جست‌وجو و مقایسه کنم؟"
            intro="هر نتیجه نماینده یک ملک است. ممکن است چند منبع برای همان ملک آگهی داشته باشند؛ شرایط هر آگهی را جداگانه بررسی کنید."
          >
            <Checklist
              items={[
                "محله و نوع ملک را انتخاب کنید، سپس فیلترهای ودیعه، اجاره و مشخصات را متناسب با نیاز خود تنظیم کنید.",
                "ودیعه و اجاره ماهانه یک آگهی را با هم مقایسه کنید؛ کمترین ودیعه یک منبع را با کمترین اجاره منبع دیگر ترکیب نکنید.",
                "در صفحه ملک، نام منبع، زمان به‌روزرسانی و اختلاف اطلاعات آگهی‌ها را بخوانید. نبود اطلاعات درباره یک امکان به معنی نداشتن آن نیست.",
                "برای آگهی وب‌سایت، از لینک منبع ادامه دهید؛ برای آگهی مستقیم، از مسیر تماس نمایش‌داده‌شده استفاده کنید.",
                "موقعیت روی نقشه تقریبی است. موجود بودن ملک و شرایط فعلی را با منبع آگهی هماهنگ کنید.",
              ]}
            />
            <ActionLink to="/search">جست‌وجوی ملک</ActionLink>
          </Section>
          <Section
            activeTopic={activeTopic}
            id="follow-up"
            title="پیگیری و رفع مشکل"
            intro="وضعیت پیشنهادها و درخواست‌های خود را در داشبورد ببینید. پیام‌ها و اعلان‌های مرتبط به شما کمک می‌کنند قدم بعدی را پیدا کنید."
          >
            {[
              [
                "درخواست من هنوز منتشر نشده است",
                "ثبت درخواست، تأیید سایت و انتشار آگهی مراحل جداگانه‌اند. وضعیت پرونده و پیام تیم بررسی را ببینید؛ ارسال دوباره همان درخواست، بررسی را سریع‌تر نمی‌کند.",
              ],
              [
                "بعضی آگهی‌های سایتم خوانده نشده‌اند",
                "عمومی بودن صفحه، کامل بودن اطلاعات و هماهنگی متن و داده ساخت‌یافته را بررسی کنید. پس از اصلاح سایت، از پرونده منبع نتیجه را پیگیری کنید و در صورت دسترسی درخواست پردازش ثبت کنید.",
              ],
              [
                "قالب سایت یا شرایط ملک تغییر کرده است",
                "اطلاعات سایت را به‌روز کنید و تغییر مهم قالب را در گفتگوی پرونده سایت به تیم بررسی اطلاع دهید. برای ملک ثبت‌شده، از اقدام‌های در دسترس داشبورد برای اصلاح یا اعلام ناموجودی استفاده کنید.",
              ],
              [
                "اطلاعات نادرست یا مشکل تماس دیده‌ام",
                "نشانی صفحه و توضیح کوتاه مشکل را برای پشتیبانی بفرستید. رمز، کد تأیید یا مدارک خصوصی را در متن پیام قرار ندهید.",
              ],
            ].map(([question, answer]) => (
              <details key={question} className="rounded-xl border px-4 py-2">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">
                  {question}
                </summary>
                <p className="text-muted-foreground pt-2 pb-3">{answer}</p>
              </details>
            ))}
            <div className="flex flex-wrap gap-x-6">
              <ActionLink to="/dashboard">داشبورد من</ActionLink>
              <ActionLink to="/messages">پیام‌ها و اعلان‌ها</ActionLink>
              <ActionLink to="/contact">تماس با پشتیبانی</ActionLink>
            </div>
            <p className="text-muted-foreground text-sm">
              برای آشنایی با نحوه نگهداری اطلاعات،{" "}
              <Link to="/privacy" className="underline underline-offset-4">
                حریم خصوصی
              </Link>{" "}
              و{" "}
              <Link to="/terms" className="underline underline-offset-4">
                شرایط استفاده
              </Link>{" "}
              را بخوانید.
            </p>
          </Section>
          <nav
            aria-label="ادامه راهنما"
            className="flex flex-wrap items-center justify-between gap-4 text-sm"
          >
            {previous ? (
              <ActionLink to={`/guide?topic=${previous.id}`}>
                قبلی: {previous.title}
              </ActionLink>
            ) : (
              <span />
            )}
            {next && (
              <ActionLink to={`/guide?topic=${next.id}`}>
                بعدی: {next.title}
              </ActionLink>
            )}
          </nav>
        </div>
      </div>
    </main>
  );
}
