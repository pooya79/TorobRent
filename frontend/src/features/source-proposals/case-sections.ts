import {
  FileCheck2,
  Globe2,
  History,
  ListFilter,
  ScanSearch,
  Settings2,
  UsersRound,
} from "lucide-react";

export const caseSections = [
  {
    id: "overview",
    label: "نمای کلی",
    title: "منبع و نماینده",
    description:
      "اطلاعات اعلام‌شده را با هویت ارسال‌کننده و نشانی منبع تطبیق دهید.",
    icon: Globe2,
  },
  {
    id: "url",
    label: "نشانی و کشف",
    title: "بررسی نشانی و کشف صفحات",
    description:
      "نشانی و اختیار نماینده را تأیید کنید؛ سپس دامنه بررسی صفحات را تعیین کنید.",
    icon: ScanSearch,
  },
  {
    id: "profile",
    label: "پروفایل",
    title: "کیفیت استخراج اطلاعات",
    description:
      "نمونه‌ها نشان می‌دهند اطلاعات چگونه خوانده می‌شود. خطاها را اصلاح و نسخه معتبر را تأیید کنید.",
    icon: FileCheck2,
  },
  {
    id: "responsibility",
    label: "مسئولیت",
    title: "نماینده و اپراتور مسئول",
    description:
      "نماینده منبع را از اپراتوری که تصمیم‌های آن را ثبت می‌کند جدا ببینید و مسئولیت را مدیریت کنید.",
    icon: UsersRound,
  },
  {
    id: "processing",
    label: "پردازش و انتشار",
    title: "از دریافت صفحه تا انتشار آگهی",
    description:
      "دریافت صفحات و روش انتشار دو کنترل مستقل دارند. وضعیت هر کدام را پیش از تغییر بررسی کنید.",
    icon: Settings2,
  },
  {
    id: "exceptions",
    label: "ملک‌ها و نتایج",
    title: "بررسی و انتشار ملک‌های وب‌سایت",
    description:
      "ملک‌ها را ببینید، اطلاعاتشان را اصلاح کنید و درباره انتشار تصمیم بگیرید.",
    icon: ListFilter,
  },
  {
    id: "history",
    label: "گفت‌وگو و سوابق",
    title: "گفت‌وگو و سابقه تصمیم‌ها",
    description:
      "با نماینده هماهنگ شوید و ببینید چه کسی، چه زمانی و با چه دلیلی تصمیم گرفته است.",
    icon: History,
  },
] as const;
export type CaseSectionId = (typeof caseSections)[number]["id"];
