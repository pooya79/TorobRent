const ruleLabels: Record<string, string> = {
  kind: "روش خواندن",
  selector: "عنصر صفحه",
  path: "مسیر داده",
  attribute: "ویژگی عنصر",
  transform: "تبدیل مقدار",
  currency_hint: "واحد مبلغ",
  pattern: "الگوی جستجو",
  value: "مقدار ثابت",
  alternatives: "روش‌های جایگزین",
  regex: "الگوی متن",
};
const valueLabels: Record<string, string> = {
  css: "خواندن از صفحه",
  json: "داده ساخت‌یافته",
  text: "متن",
  integer: "عدد صحیح",
  money_rial: "مبلغ به ریال",
  property_type: "نوع ملک",
  feature: "وجود امکانات",
  url_list: "فهرست نشانی‌ها",
};

export function ProfileRule({ rule }: { rule: unknown }) {
  if (rule == null)
    return <p className="text-muted-foreground text-sm">قاعده‌ای ثبت نشده</p>;
  if (Array.isArray(rule))
    return (
      <div className="grid gap-3">
        {rule.map((item: unknown, index) => (
          <div className="border-s-2 ps-3" key={index}>
            <ProfileRule rule={item} />
          </div>
        ))}
      </div>
    );
  if (
    typeof rule === "string" ||
    typeof rule === "number" ||
    typeof rule === "boolean"
  )
    return (
      <span className="break-all" dir="auto">
        {valueLabels[String(rule)] ?? String(rule)}
      </span>
    );
  if (typeof rule !== "object") return null;
  return (
    <dl className="grid gap-2 text-sm">
      {Object.entries(rule).map(([key, value]: [string, unknown]) => (
        <div key={key} className="grid min-w-0 gap-1">
          <dt className="text-muted-foreground">{ruleLabels[key] ?? key}</dt>
          <dd className="bg-muted/50 min-w-0 rounded-md px-3 py-2">
            <ProfileRule rule={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
