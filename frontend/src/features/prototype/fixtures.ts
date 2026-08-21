export type PrototypeProperty = {
  id: string;
  title: string;
  location: string;
  facts: readonly string[];
  listingCountLabel: string;
  depositLabel: string;
  rentLabel: string;
  freshnessLabel: string;
  imageUrl?: string;
};

const properties: readonly PrototypeProperty[] = [
  {
    id: "saadat-abad-101",
    title: "آپارتمان روشن در سعادت‌آباد",
    location: "تهران، سعادت‌آباد",
    facts: ["۱۱۰ متر", "۲ خواب", "طبقه چهارم"],
    listingCountLabel: "۳ آگهی فعال",
    depositLabel: "ودیعه ۱ میلیارد تومان",
    rentLabel: "اجاره ماهانه ۲۵ میلیون تومان",
    freshnessLabel: "به‌روزرسانی امروز",
  },
  {
    id: "yousef-abad-204",
    title: "خانه آرام نزدیک پارک شفق",
    location: "تهران، یوسف‌آباد",
    facts: ["۸۵ متر", "۲ خواب", "آسانسور"],
    listingCountLabel: "۲ آگهی فعال",
    depositLabel: "ودیعه ۸۰۰ میلیون تومان",
    rentLabel: "اجاره ماهانه ۲۱ میلیون تومان",
    freshnessLabel: "به‌روزرسانی دیروز",
  },
  {
    id: "tehran-pars-12",
    title: "آپارتمان خانوادگی در تهران‌پارس",
    location: "تهران، تهران‌پارس",
    facts: ["۹۵ متر", "۲ خواب", "پارکینگ"],
    listingCountLabel: "۱ آگهی فعال",
    depositLabel: "ودیعه ۷۰۰ میلیون تومان",
    rentLabel: "اجاره ماهانه ۱۸ میلیون تومان",
    freshnessLabel: "به‌روزرسانی امروز",
  },
];

const listings = [
  {
    source: "منبع مستقیم",
    deposit: "۱ میلیارد تومان",
    rent: "۲۵ میلیون تومان",
    freshness: "امروز",
    status: "تأییدشده",
  },
  {
    source: "ملک‌رادار",
    deposit: "۹۵۰ میلیون تومان",
    rent: "۲۶ میلیون تومان",
    freshness: "امروز",
    status: "فعال",
  },
  {
    source: "خانه‌نما",
    deposit: "۱ میلیارد تومان",
    rent: "۲۵ میلیون تومان",
    freshness: "دیروز",
    status: "فعال",
  },
] as const;

const submissions = [
  {
    title: "آگهی سعادت‌آباد",
    status: "نیازمند اصلاح",
    detail: "تصویر سند مالکیت خوانا نیست.",
    time: "بازبینی در ۲۹ مرداد ۱۴۰۵",
    action: "رفع ایرادهای آگهی سعادت‌آباد",
    href: "/add-submission?draft=saadat-abad",
    state: "needs-change",
  },
  {
    title: "آگهی یوسف‌آباد",
    status: "در انتظار بررسی",
    detail: "ارسال کامل است و در صف بررسی قرار دارد.",
    time: "ارسال در ۲۸ مرداد ۱۴۰۵",
    action: "مشاهده جزئیات آگهی یوسف‌آباد",
    href: "/dashboard/submissions/yousef-abad",
    state: "pending",
  },
  {
    title: "آگهی تهران‌پارس",
    status: "منتشر شده",
    detail: "تا ۱۲ شهریور ۱۴۰۵ فعال است.",
    time: "انتشار در ۲۵ مرداد ۱۴۰۵",
    action: "مشاهده آگهی منتشرشده تهران‌پارس",
    href: "/properties/tehran-pars-12",
    state: "published",
  },
] as const;

const reviewQueue = [
  { title: "سعادت‌آباد، بلوار دریا", role: "مالک", time: "۲ ساعت پیش" },
  { title: "یوسف‌آباد، خیابان اسدآبادی", role: "نماینده", time: "۴ ساعت پیش" },
  { title: "تهران‌پارس، فلکه دوم", role: "مالک", time: "دیروز" },
] as const;

const reviewFacts = [
  ["نوع ملک", "آپارتمان"],
  ["متراژ", "۱۱۰ متر"],
  ["ودیعه", "۱ میلیارد تومان"],
  ["اجاره ماهانه", "۲۵ میلیون تومان"],
  ["نقش ثبت‌کننده", "مالک"],
  ["تعداد تصاویر", "۶ تصویر"],
] as const;

const reviewHistory = [
  ["بررسی اپراتور آغاز شد", "امروز، ۱۰:۴۵"],
  ["ارسال برای بررسی", "امروز، ۰۸:۳۱"],
  ["پیش‌نویس ایجاد شد", "۲۹ مرداد، ۱۸:۱۲"],
] as const;

const reviewSummary = {
  pendingCountLabel: "۱۲ مورد در انتظار بررسی",
  title: "سعادت‌آباد، بلوار دریا",
  sourceLabel: "ارسال مستقیم مالک · کد TR-1042",
  status: "در انتظار بررسی",
  warningTitle: "مدرک مالکیت نیاز به بررسی دارد",
  warningDetail:
    "نام روی مدرک با نام حساب همسان است، اما گوشه پایین تصویر خوانا نیست.",
} as const;

export interface PrototypeRepository {
  getProperties(): readonly PrototypeProperty[];
  getProperty(id: string): PrototypeProperty;
  getListings(propertyId: string): readonly (typeof listings)[number][];
  getSubmissions(): typeof submissions;
  getReviewQueue(): typeof reviewQueue;
  getReviewFacts(): typeof reviewFacts;
  getReviewHistory(): typeof reviewHistory;
  getReviewSummary(): typeof reviewSummary;
}

export const prototypeRepository: PrototypeRepository = {
  getProperties: () => properties,
  getProperty: (id) =>
    properties.find((property) => property.id === id) ?? properties[0]!,
  getListings: (propertyId) =>
    listings.slice(
      0,
      propertyId === "tehran-pars-12"
        ? 1
        : propertyId === "yousef-abad-204"
          ? 2
          : 3,
    ),
  getSubmissions: () => submissions,
  getReviewQueue: () => reviewQueue,
  getReviewFacts: () => reviewFacts,
  getReviewHistory: () => reviewHistory,
  getReviewSummary: () => reviewSummary,
};
