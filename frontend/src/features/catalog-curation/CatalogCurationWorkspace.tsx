import { BarChart3, GitCompareArrows, Layers3, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router";
import { PageMain } from "@/components/layout/PageMain";
import { cn } from "@/lib/utils";
import { PropertyMatchSuggestions } from "./PropertyMatchSuggestions";
import { GroupedProperties } from "./GroupedProperties";
import { ManualPropertyComparison } from "./ManualPropertyComparison";
import { CurationMetrics } from "./CurationMetrics";

const sections = [
  {
    key: "suggestions",
    label: "پیشنهادها",
    description: "بررسی تطبیق‌های پیشنهادی",
    icon: Sparkles,
  },
  {
    key: "groups",
    label: "ملک‌های گروه‌بندی‌شده",
    description: "بازبینی و اصلاح گروه‌ها",
    icon: Layers3,
  },
  {
    key: "compare",
    label: "مقایسه دستی",
    description: "جست‌وجو و مقایسه دو ملک",
    icon: GitCompareArrows,
  },
  {
    key: "metrics",
    label: "گزارش عملکرد",
    description: "وضعیت صف و کیفیت تصمیم‌ها",
    icon: BarChart3,
  },
];

export function CatalogCurationWorkspace() {
  const location = useLocation();
  const segment = location.pathname.split("/").filter(Boolean).at(-1);
  const active = sections.some((section) => section.key === segment)
    ? segment
    : "suggestions";
  return (
    <PageMain className="max-w-7xl">
      <header className="mb-8">
        <p className="text-primary mb-3 flex items-center gap-2 text-sm font-medium">
          <Layers3 className="size-4" aria-hidden="true" /> مدیریت هویت ملک‌ها
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          ساماندهی کاتالوگ
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-7">
          آگهی‌های یک ملک را کنار هم قرار دهید، تطبیق‌ها را بررسی کنید و
          گروه‌های اشتباه را اصلاح کنید.
        </p>
      </header>
      <nav
        className="mb-8 grid grid-cols-2 gap-2 xl:grid-cols-4"
        aria-label="بخش‌های ساماندهی کاتالوگ"
      >
        {sections.map(({ key, label, description, icon: Icon }) => {
          const params = new URLSearchParams(location.search);
          params.delete("suggestion");
          params.delete("group");
          return (
            <Link
              key={key}
              to={{
                pathname: `/operator/catalog-curation/${key}`,
                search: params.toString(),
              }}
              aria-current={active === key ? "page" : undefined}
              className={cn(
                "group focus-visible:outline-ring flex min-w-0 items-start gap-3 rounded-xl border p-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-4",
                active === key
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "bg-background text-muted-foreground hover:border-primary/30 hover:bg-muted/50",
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span
                  aria-hidden="true"
                  className="text-muted-foreground mt-1 hidden text-xs leading-5 sm:block"
                >
                  {description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="bg-background min-w-0 rounded-2xl border p-4 shadow-sm sm:p-6 lg:p-8">
        {active === "suggestions" ? <PropertyMatchSuggestions /> : null}
        {active === "groups" ? <GroupedProperties /> : null}
        {active === "compare" ? <ManualPropertyComparison /> : null}
        {active === "metrics" ? <CurationMetrics /> : null}
      </div>
    </PageMain>
  );
}
