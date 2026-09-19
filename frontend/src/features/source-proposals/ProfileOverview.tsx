import { Braces, CheckCheck, GitBranch, Monitor } from "lucide-react";
import type { components } from "@/lib/api/schema";
import { fields } from "./profile-presentation";

type Version = components["schemas"]["SourceProfileVersion"];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function method(value: unknown): string {
  const rule = record(value);
  if (rule.kind === "json")
    return !rule.script_selector ||
      (typeof rule.script_selector === "string" &&
        rule.script_selector.includes("ld+json"))
      ? "JSON-LD"
      : "JSON";
  if (rule.kind === "css" || typeof rule.selector === "string")
    return /^meta\b/i.test(String(rule.selector).trim())
      ? "Meta tags"
      : "DOM / CSS";
  return "سایر قواعد";
}
const number = (value: number) => value.toLocaleString("fa-IR");

export function ProfileOverview({
  version,
  renderingMethods,
}: {
  version: Version;
  renderingMethods?: Record<string, number>;
}) {
  const rules = Object.values(record(version.rules))
    .map((value) => {
      const variants = record(value).variants;
      return Array.isArray(variants) ? (variants as unknown[]) : [value];
    })
    .filter((variants) => variants.length > 0);
  const methods = new Map<string, number>();
  for (const variants of rules) {
    const name = method(variants[0]);
    methods.set(name, (methods.get(name) ?? 0) + 1);
  }
  const ranked = [...methods].sort((a, b) => b[1] - a[1]);
  const leading = ranked.filter(([, count]) => count === ranked[0]?.[1]);
  const fallbackCount = rules.filter((variants) => variants.length > 1).length;
  const recognized = Object.keys(fields).filter((field) =>
    version.samples.some((sample) => {
      const value = sample.normalized[field];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== "unknown" &&
        (!Array.isArray(value) || value.length > 0) &&
        !sample.unresolved.includes(field) &&
        !(field in sample.conflicts)
      );
    }),
  ).length;
  const total = Object.keys(fields).length;
  const http = renderingMethods?.http ?? 0;
  const browser = renderingMethods?.browser ?? 0;
  const renderingKnown = http + browser > 0;
  return (
    <section
      aria-label="خلاصه استخراج پروفایل"
      className="via-background overflow-hidden rounded-2xl border bg-gradient-to-bl from-sky-500/10 to-violet-500/10"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <h3 className="font-semibold">پروفایل در یک نگاه</h3>
        <span className="text-muted-foreground text-xs">
          نسخه {number(version.number)} ·{" "}
          {version.provenance === "llm"
            ? "اصلاح هوشمند"
            : version.provenance === "manual"
              ? "اصلاح دستی"
              : "تشخیص خودکار"}
        </span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-4">
          <Braces
            aria-hidden="true"
            className="mb-3 size-5 text-sky-700 dark:text-sky-300"
          />
          <h4 className="text-sm">روش اصلی قواعد</h4>
          <p className="mt-2 text-xl font-semibold" dir="auto">
            {leading.length > 1 ? "ترکیبی" : (leading[0]?.[0] ?? "بدون قاعده")}
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-6">
            بر اساس اولین روش هر فیلد؛ روش استخراج می‌تواند بین فیلدها متفاوت
            باشد.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ranked.map(([name, count]) => (
              <span
                key={name}
                className="bg-background/70 rounded-md px-2 py-1 text-xs"
              >
                <bdi>{name}</bdi> · {number(count)}
              </span>
            ))}
          </div>
        </article>
        <article className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-4">
          <GitBranch
            aria-hidden="true"
            className="mb-3 size-5 text-violet-700 dark:text-violet-300"
          />
          <h4 className="text-sm">روش‌های جایگزین</h4>
          <p className="mt-2 text-xl font-semibold">
            {number(fallbackCount)} فیلد
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-6">
            از {number(rules.length)} فیلد دارای قاعده. اگر یک روش مقدار یکتا و
            قابل قبول ندهد، روش بعدی همان فیلد امتحان می‌شود.
          </p>
        </article>
        <article className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <Monitor
            aria-hidden="true"
            className="mb-3 size-5 text-amber-700 dark:text-amber-300"
          />
          <h4 className="text-sm">اجرای JavaScript</h4>
          <p className="mt-2 text-xl font-semibold">
            {!renderingKnown
              ? "هنوز مشخص نیست"
              : browser > 0
                ? "مرورگر استفاده شد"
                : "HTML کافی بود"}
          </p>
          <p className="text-muted-foreground mt-2 text-xs leading-6">
            {renderingKnown
              ? `${number(http)} صفحه با HTTP · ${number(browser)} صفحه با مرورگر. بر اساس صفحات دریافت‌شده در این کشف؛ نیاز همه صفحات سایت را تعیین نمی‌کند.`
              : "روش دریافت در شواهد این نسخه ثبت نشده است. بررسی تازه سایت، این اطلاعات را ثبت می‌کند."}
          </p>
        </article>
        <article className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <CheckCheck
            aria-hidden="true"
            className="mb-3 size-5 text-emerald-700 dark:text-emerald-300"
          />
          <h4 className="text-sm">فیلدهای شناسایی‌شده</h4>
          <p className="mt-2 text-xl font-semibold">
            {version.samples.length
              ? `${number(recognized)} از ${number(total)}`
              : "نمونه‌ای ثبت نشده"}
          </p>
          <progress
            aria-label="تعداد فیلدهای شناسایی‌شده"
            value={recognized}
            max={total}
            className="mt-3 h-2 w-full accent-emerald-600"
          />
          <p className="text-muted-foreground mt-2 text-xs leading-6">
            مقدار معتبر و بدون تعارض در دست‌کم یک نمونه از{" "}
            {number(version.samples.length)} صفحه؛ به معنی تأیید درستی همه
            مقادیر نیست.
          </p>
        </article>
      </div>
      <details className="border-t px-5 py-3 text-sm">
        <summary>تشخیص و جایگزینی روش‌ها چگونه کار می‌کند؟</summary>
        <div className="text-muted-foreground mt-3 space-y-2 leading-7">
          <p>
            ابتدا صفحات آگهی با ساختار مشابه انتخاب می‌شوند. قواعد خودکار از
            داده‌های JSON-LD، متا تگ‌ها و عناصر پایدار صفحه ساخته می‌شوند. هر
            قاعده باید در حداقل ۸۰٪ صفحات ساخت قواعد، مقدار یکتا بدهد و در
            هیچ‌کدام چند مقدار متفاوت نداشته باشد.
          </p>
          <p>
            ترتیب پیش‌فرض: JSON-LD، سپس Meta tags و سپس DOM / CSS. در هر گروه،
            پوشش بیشتر اولویت دارد. اولین روش قابل قبول هر فیلد استفاده می‌شود؛
            قواعد دستی و اصلاح هوشمند می‌توانند این ترتیب را تغییر دهند.
          </p>
          <p>
            کیفیت با صفحات مستقل سنجیده می‌شود:{" "}
            {number(version.validation.training_page_urls.length)} صفحه برای
            ساخت قواعد و {number(version.validation.held_out_page_urls.length)}{" "}
            صفحه برای اعتبارسنجی. شواهد دیگر صفحه هم بررسی می‌شوند و تعارض
            فیلدهای اصلی برای بازبینی گزارش می‌شود.
          </p>
          <p>
            دریافت ابتدا با HTTP انجام می‌شود. اگر صفحه شبیه پوسته خالی
            JavaScript باشد، مرورگر امتحان می‌شود. وجود اسکریپت به‌تنهایی به
            معنی نیاز به رندر نیست.
          </p>
        </div>
      </details>
    </section>
  );
}
