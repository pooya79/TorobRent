const explanations: Record<string, string> = {
  rental_listing: "این صفحه به عنوان آگهی اجاره شناسایی شده است.",
  rental_index:
    "این صفحه فهرستی از آگهی‌های اجاره است و برای یافتن صفحات آگهی استفاده می‌شود.",
  other_property:
    "این صفحه درباره ملک است، اما در دسته آگهی اجاره قرار نمی‌گیرد.",
  irrelevant:
    "نشانه کافی برای شناسایی این صفحه به عنوان آگهی یا فهرست اجاره پیدا نشد.",
  blocked: "دسترسی به این صفحه مسدود بوده و محتوای آن قابل بررسی نبوده است.",
  fetch_error: "دریافت یا خواندن محتوای این صفحه موفق نبوده است.",
};
const signals: Record<string, string> = {
  "Rental terminology is present":
    "واژه‌های مربوط به رهن و اجاره در صفحه وجود دارد",
  "A contact action is present": "راه ارتباط یا تماس در صفحه وجود دارد",
  "The page has one primary heading": "صفحه یک عنوان اصلی دارد",
  "The page URL has an individual listing identifier":
    "نشانی صفحه دارای شناسه یک آگهی است",
  "The page is property-related but not a rental listing":
    "محتوای صفحه درباره ملک است، اما آگهی اجاره نیست",
  "No reliable rental-property signals were found":
    "نشانه قابل اتکایی از ملک اجاره‌ای پیدا نشد",
  "A rental index identified this pagination URL":
    "این نشانی ادامه صفحات یک فهرست اجاره است",
  "A rental index identified this structured listing URL":
    "این آگهی از داده‌های ساختاریافته فهرست اجاره شناسایی شده است",
  "The detail response did not independently expose enough signals":
    "محتوای خود صفحه برای تشخیص مستقل آگهی کافی نبوده است",
};

export function discoveryDescription(
  classification: string,
  description: string,
) {
  const translated = description
    .split("؛")
    .map((part) => {
      const text = part.trim();
      if (signals[text]) return signals[text];
      if (text.startsWith("Property details found: ")) {
        const details = text
          .slice("Property details found: ".length)
          .replaceAll("listing id", "شناسه آگهی")
          .replaceAll(",", "،");
        if (!/[a-z]/i.test(details))
          return `مشخصات ملک در صفحه پیدا شده است: ${details}`;
      }
      const links = /^The page links to (\d+) listing-like pages$/.exec(text);
      if (links)
        return `صفحه به ${Number(links[1]).toLocaleString("fa-IR")} صفحه مشابه آگهی پیوند دارد`;
      const structured =
        /^Structured data references (\d+) individual listings$/.exec(text);
      if (structured)
        return `داده‌های ساختاریافته صفحه شامل ${Number(structured[1]).toLocaleString("fa-IR")} آگهی مستقل است`;
      const http = /^Unsupported response: HTTP (\d+)/.exec(text);
      if (http)
        return `پاسخ دریافتی با کد ${Number(http[1]).toLocaleString("fa-IR")} برای بررسی صفحه قابل استفاده نیست`;
      return /[\u0600-\u06ff]/.test(text) && !/[a-z]/i.test(text) ? text : "";
    })
    .filter(Boolean);
  return translated.length
    ? translated.join("؛ ")
    : `${explanations[classification] ?? "نوع این صفحه هنوز مشخص نشده است."} جزئیات بیشتری از دلیل تشخیص در این اجرا ذخیره نشده است.`;
}
