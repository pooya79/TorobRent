export type PrototypeProperty = {
  id: string;
  title: string;
  location: string;
  facts: readonly string[];
  imageUrl?: string;
};

export type PrototypeRentalTerms = {
  depositLabel: string;
  monthlyRentLabel: string;
};

type PrototypeListing = {
  propertyId: string;
  source: string;
  rentalTerms: PrototypeRentalTerms;
  freshness: string;
  status: string;
};

export type PrototypePropertySummary = PrototypeProperty & {
  listingCountLabel: string;
  rentalTerms: PrototypeRentalTerms;
  freshnessLabel: string;
};

const properties: readonly PrototypeProperty[] = [
  {
    id: "saadat-abad-101",
    title: "آپارتمان روشن در سعادت‌آباد",
    location: "تهران، سعادت‌آباد",
    facts: ["۱۱۰ متر", "۲ خواب", "طبقه چهارم"],
  },
  {
    id: "yousef-abad-204",
    title: "خانه آرام نزدیک پارک شفق",
    location: "تهران، یوسف‌آباد",
    facts: ["۸۵ متر", "۲ خواب", "آسانسور"],
  },
  {
    id: "tehran-pars-12",
    title: "آپارتمان خانوادگی در تهران‌پارس",
    location: "تهران، تهران‌پارس",
    facts: ["۹۵ متر", "۲ خواب", "پارکینگ"],
  },
];

const listings: readonly PrototypeListing[] = [
  {
    propertyId: "saadat-abad-101",
    source: "منبع مستقیم",
    rentalTerms: {
      depositLabel: "۱ میلیارد تومان",
      monthlyRentLabel: "۲۵ میلیون تومان",
    },
    freshness: "امروز",
    status: "تأییدشده",
  },
  {
    propertyId: "saadat-abad-101",
    source: "ملک‌رادار",
    rentalTerms: {
      depositLabel: "۹۵۰ میلیون تومان",
      monthlyRentLabel: "۲۶ میلیون تومان",
    },
    freshness: "امروز",
    status: "فعال",
  },
  {
    propertyId: "saadat-abad-101",
    source: "خانه‌نما",
    rentalTerms: {
      depositLabel: "۱ میلیارد تومان",
      monthlyRentLabel: "۲۵ میلیون تومان",
    },
    freshness: "دیروز",
    status: "فعال",
  },
  {
    propertyId: "yousef-abad-204",
    source: "منبع مستقیم",
    rentalTerms: {
      depositLabel: "۸۰۰ میلیون تومان",
      monthlyRentLabel: "۲۱ میلیون تومان",
    },
    freshness: "دیروز",
    status: "تأییدشده",
  },
  {
    propertyId: "yousef-abad-204",
    source: "خانه‌نما",
    rentalTerms: {
      depositLabel: "۸۵۰ میلیون تومان",
      monthlyRentLabel: "۲۰ میلیون تومان",
    },
    freshness: "۲ روز پیش",
    status: "فعال",
  },
  {
    propertyId: "tehran-pars-12",
    source: "منبع مستقیم",
    rentalTerms: {
      depositLabel: "۷۰۰ میلیون تومان",
      monthlyRentLabel: "۱۸ میلیون تومان",
    },
    freshness: "امروز",
    status: "تأییدشده",
  },
];

const persianCounts = ["۰", "۱", "۲", "۳"] as const;

function summarizeProperty(
  property: PrototypeProperty,
): PrototypePropertySummary {
  const propertyListings = listings.filter(
    (listing) => listing.propertyId === property.id,
  );
  const freshestListing = propertyListings[0]!;
  return {
    ...property,
    listingCountLabel: `${persianCounts[propertyListings.length]} آگهی فعال`,
    rentalTerms: freshestListing.rentalTerms,
    freshnessLabel: `به‌روزرسانی ${freshestListing.freshness}`,
  };
}

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
  getProperties(): readonly PrototypePropertySummary[];
  getProperty(id: string): PrototypePropertySummary;
  getListings(propertyId: string): readonly PrototypeListing[];
  getSubmissions(): typeof submissions;
  getReviewQueue(): typeof reviewQueue;
  getReviewFacts(): typeof reviewFacts;
  getReviewHistory(): typeof reviewHistory;
  getReviewSummary(): typeof reviewSummary;
}

export const prototypeRepository: PrototypeRepository = {
  getProperties: () => properties.map(summarizeProperty),
  getProperty: (id) =>
    summarizeProperty(
      properties.find((property) => property.id === id) ?? properties[0]!,
    ),
  getListings: (propertyId) =>
    listings.filter((listing) => listing.propertyId === propertyId),
  getSubmissions: () => submissions,
  getReviewQueue: () => reviewQueue,
  getReviewFacts: () => reviewFacts,
  getReviewHistory: () => reviewHistory,
  getReviewSummary: () => reviewSummary,
};
