import { useState, type ReactNode } from "react";
import { ImageOff, Expand } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { roomCountLabels } from "@/features/catalog/property-taxonomy";
import type { Submission, SubmissionImage } from "./queries";

const missing = "ثبت نشده";
const number = (value: number | null | undefined) =>
  value == null ? missing : value.toLocaleString("fa-IR");
const yesNo = (value: boolean | undefined) =>
  value == null ? missing : value ? "بله" : "خیر";
const features = [
  ["parking", "پارکینگ"],
  ["elevator", "آسانسور"],
  ["storage", "انباری"],
  ["balcony", "بالکن"],
  ["furnished", "مبله"],
] as const;
const states = { present: "دارد", absent: "ندارد", unknown: "نامشخص" };
const imageStates = {
  pending: "در صف پردازش",
  processing: "در حال پردازش",
  failed: "پردازش ناموفق",
  ready: "تصویر در دسترس نیست",
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-2 text-sm font-medium break-words">{children}</dd>
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card space-y-5 rounded-xl border p-4 sm:p-5">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}
function ReviewImage({
  image,
  large = false,
}: {
  image: SubmissionImage;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const variant =
    image.variants.find((item) => item.kind === (large ? "large" : "medium")) ??
    image.variants[0];
  return variant && !failed ? (
    <img
      src={variant.url}
      alt={`تصویر ${image.position + 1} ملک`}
      className={
        large
          ? "max-h-[75vh] w-full object-contain"
          : "h-64 w-full object-contain sm:h-80"
      }
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 p-5 text-sm">
      <ImageOff aria-hidden="true" />
      <p>
        {failed
          ? "بارگذاری تصویر ناموفق بود"
          : imageStates[image.status ?? "pending"]}
      </p>
      {image.failure_reason && (
        <p className="break-words">{image.failure_reason}</p>
      )}
    </div>
  );
}
function Gallery({ images }: { images: SubmissionImage[] }) {
  const ordered = [...images].sort((a, b) => a.position - b.position);
  const [activeId, setActiveId] = useState(
    () => ordered.find((item) => item.is_primary)?.id ?? ordered[0]?.id,
  );
  const active = ordered.find((item) => item.id === activeId) ?? ordered[0];
  return (
    <section
      aria-label="تصاویر ارسالی ملک"
      className="overflow-hidden rounded-xl border"
    >
      <div className="bg-card flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="font-semibold">
          تصاویر ملک{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({number(images.length)})
          </span>
        </h3>
        {active?.is_primary && <Badge variant="secondary">تصویر اصلی</Badge>}
      </div>
      <div className="bg-muted/40">
        {active ? (
          <ReviewImage key={active.id} image={active} />
        ) : (
          <p className="text-muted-foreground p-8 text-center text-sm">
            تصویری برای این ملک ثبت نشده است.
          </p>
        )}
      </div>
      {active && (
        <div className="bg-card flex flex-wrap items-center justify-between gap-3 border-t p-3">
          <div className="flex flex-wrap gap-2" aria-label="انتخاب تصویر">
            {ordered.map((item, index) => (
              <Button
                key={item.id}
                size="sm"
                variant={item.id === active.id ? "default" : "outline"}
                aria-pressed={item.id === active.id}
                aria-label={`نمایش تصویر ${index + 1}`}
                onClick={() => setActiveId(item.id)}
              >
                {number(index + 1)}
              </Button>
            ))}
          </div>
          {active.variants.length > 0 && (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Expand aria-hidden="true" />
                  بزرگ‌نمایی تصویر
                </Button>
              </DialogTrigger>
              <DialogContent
                dir="rtl"
                className="sm:max-w-5xl"
                aria-describedby={undefined}
              >
                <DialogTitle>
                  تصویر {number(ordered.indexOf(active) + 1)} ملک
                </DialogTitle>
                <ReviewImage key={active.id} image={active} large />
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </section>
  );
}

export function SubmissionDetails({ submission }: { submission: Submission }) {
  const {
    property_facts: facts,
    rental_terms: terms,
    location,
    contact,
  } = submission;
  return (
    <div className="space-y-4">
      <Gallery key={submission.id} images={submission.images} />
      <Section title="مشخصات ملک">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
          <Detail label="نوع ملک">
            {facts?.property_type_label || missing}
          </Detail>
          <Detail label="دسته ملک">
            {facts?.property_category_label || missing}
          </Detail>
          <Detail label="متراژ">
            {facts ? `${number(facts.area_sqm)} متر مربع` : missing}
          </Detail>
          <Detail
            label={
              facts
                ? roomCountLabels[facts.property_category].field
                : "تعداد اتاق"
            }
          >
            {number(facts?.room_count)}
          </Detail>
          <Detail label="سال ساخت">
            {facts?.construction_year?.toLocaleString("fa-IR", {
              useGrouping: false,
            }) ?? missing}
          </Detail>
          <Detail label="طبقه">{number(facts?.floor)}</Detail>
          <Detail label="تعداد طبقات">{number(facts?.total_floors)}</Detail>
          <Detail label="واحد در طبقه">{number(facts?.units_per_floor)}</Detail>
        </dl>
        <div className="border-t pt-4">
          <h4 className="mb-3 text-sm font-medium">امکانات</h4>
          <dl className="flex flex-wrap gap-2">
            {features.map(([key, label]) => (
              <div
                key={key}
                className="bg-muted/40 flex gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <dt>{label}</dt>
                <dd className="text-muted-foreground">
                  {states[submission.features?.[key] ?? "unknown"]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>
      <Section title="شرایط اجاره">
        <dl className="grid grid-cols-2 gap-6">
          <Detail label="رهن">
            {terms ? `${number(terms.deposit_toman)} تومان` : missing}
          </Detail>
          <Detail label="اجاره ماهانه">
            {terms ? `${number(terms.monthly_rent_toman)} تومان` : missing}
          </Detail>
          <Detail label="قابل مذاکره">{yesNo(terms?.is_negotiable)}</Detail>
          <Detail label="قابل تبدیل">{yesNo(terms?.is_convertible)}</Detail>
        </dl>
      </Section>
      <Section title="توضیحات ثبت‌کننده">
        <p className="text-sm leading-8 break-words whitespace-pre-wrap">
          {submission.description?.trim()
            ? submission.description
            : "توضیحی ثبت نشده است."}
        </p>
      </Section>
      <Section title="نشانی و موقعیت">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <Detail label="شهر">{location?.city || missing}</Detail>
          <Detail label="منطقه">{location?.district || missing}</Detail>
          <Detail label="محله">{location?.neighborhood || missing}</Detail>
          <div className="col-span-full">
            <Detail label="نشانی دقیق">{location?.address || missing}</Detail>
          </div>
          <Detail label="عرض جغرافیایی">
            <bdi>{location?.exact_location?.latitude ?? missing}</bdi>
          </Detail>
          <Detail label="طول جغرافیایی">
            <bdi>{location?.exact_location?.longitude ?? missing}</bdi>
          </Detail>
        </dl>
      </Section>
      <Section title="اطلاعات ثبت‌کننده و تماس">
        <dl className="grid grid-cols-2 gap-6">
          <Detail label="نام">{contact?.name || missing}</Detail>
          <Detail label="نقش ثبت‌کننده">
            {submission.role === "owner" ? "مالک" : "نماینده"}
          </Detail>
          <Detail label="شماره تماس">
            <bdi>{contact?.phone || missing}</bdi>
          </Detail>
          <Detail label="شماره تلفن حساب کاربری">
            <bdi>{contact?.account_phone || missing}</bdi>
          </Detail>
          <Detail label="شماره تایید شده">
            {yesNo(contact?.phone_verified)}
          </Detail>
          <Detail label="منبع شماره تماس">
            {contact?.phone_source
              ? contact.phone_source === "account"
                ? "حساب کاربری"
                : "شماره دیگر"
              : missing}
          </Detail>
          <Detail label="اعلام اختیار ثبت آگهی">
            {yesNo(contact?.authorization_declared)}
          </Detail>
          <Detail label="رضایت انتشار شماره">
            {yesNo(contact?.phone_publication_consent)}
          </Detail>
        </dl>
      </Section>
    </div>
  );
}
