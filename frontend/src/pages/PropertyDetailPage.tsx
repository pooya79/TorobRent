import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Building2,
  Clock3,
  MapPin,
  Ruler,
  BedDouble,
  Layers3,
  CalendarDays,
  CarFront,
  ArrowUpDown,
  Package,
  Fence,
  Armchair,
  Flame,
  Snowflake,
  DoorOpen,
  Check,
  Minus,
  CircleHelp,
  Wallet,
  Banknote,
  MessageCircle,
  Phone,
  ExternalLink,
  BadgeCheck,
} from "lucide-react";
import { PropertyLocationMap } from "@/features/map/PropertyLocationMap";
import { PropertyGallery } from "@/features/catalog/PropertyGallery";
import { PropertyPriceHistory } from "@/features/catalog/PropertyPriceHistory";

import { PageMain } from "@/components/layout/PageMain";
import { roomCountLabels } from "@/features/catalog/property-taxonomy";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  recordPropertyView,
  resolveExternalContinuation,
  revealListingPhone,
} from "@/features/catalog/continuation";
import {
  chooseDisplayName,
  startListingInquiry,
} from "@/features/messages/queries";
import type { components } from "@/lib/api/schema";

type PropertyDetail = components["schemas"]["PropertyDetail"];
type FeatureState = components["schemas"]["FeatureStateEnum"];
type Listing = PropertyDetail["listings"][number];
type ListingInquiryAccount = {
  authenticated: boolean;
  verified: boolean;
  displayName: string;
};

const LISTING_INQUIRY_INTENT_KEY = "listing-inquiry-intent";

function rememberListingInquiryIntent(listingId: string) {
  sessionStorage.setItem(LISTING_INQUIRY_INTENT_KEY, listingId);
}

function clearListingInquiryIntent() {
  sessionStorage.removeItem(LISTING_INQUIRY_INTENT_KEY);
}

const featureLabels = {
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
} as const;

const featureIcons = {
  parking: CarFront,
  elevator: ArrowUpDown,
  storage: Package,
  balcony: Fence,
  furnished: Armchair,
} as const;

const featureStateLabels: Record<FeatureState, string> = {
  present: "دارد",
  absent: "ندارد",
  unknown: "نامشخص",
};

const sourceClaimLabels: Record<string, string> = {
  property_type: "نوع ملک",
  area_sqm: "متراژ",
  room_count: "تعداد اتاق",
  construction_year: "سال ساخت",
  floor: "طبقه",
  total_floors: "تعداد طبقات",
  units_per_floor: "واحد در طبقه",
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
  heating: "گرمایش",
  cooling: "سرمایش",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

function formatClaimValue(value: unknown) {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string" && value in featureStateLabels) {
    return featureStateLabels[value as FeatureState];
  }
  if (value === null) return "ثبت نشده";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  return JSON.stringify(value) ?? "ثبت نشده";
}

function ListingContinuation({
  listing,
  onNavigateExternal,
  account,
  onCompose,
  onRequestAccess,
}: {
  listing: Listing;
  onNavigateExternal: (url: string) => void;
  account?: ListingInquiryAccount;
  onCompose: () => void;
  onRequestAccess: (intent: () => void) => void;
}) {
  const [phone, setPhone] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const revealPhone = async () => {
    setPending(true);
    setFailed(false);
    try {
      setPhone(await revealListingPhone(listing.id));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const continueExternally = async () => {
    setPending(true);
    setFailed(false);
    try {
      onNavigateExternal(await resolveExternalContinuation(listing.id));
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3 [&>button]:w-full">
      {listing.is_responsible_submitter ? (
        <p className="bg-muted rounded-md px-3 py-2 text-sm font-semibold">
          این آگهی شماست
        </p>
      ) : null}
      {listing.contact_blocked ? (
        <Alert>
          <AlertDescription>
            ارتباط میان شما و این ثبت‌کننده مسدود شده است.
          </AlertDescription>
        </Alert>
      ) : null}
      {listing.can_message_submitter && !listing.contact_blocked ? (
        <Button
          onClick={() => {
            if (!account?.authenticated || !account.verified) {
              rememberListingInquiryIntent(listing.id);
              onRequestAccess(onCompose);
              return;
            }
            onCompose();
          }}
          type="button"
          variant="outline"
        >
          <MessageCircle aria-hidden="true" className="size-4" /> پیام به
          ثبت‌کننده
        </Button>
      ) : null}
      {listing.source.outbound_policy === "direct_contact" &&
        !listing.is_responsible_submitter &&
        !listing.contact_blocked &&
        listing.can_reveal_phone &&
        (phone ? (
          <a
            className="text-primary inline-flex min-h-11 items-center font-semibold"
            href={`tel:${phone}`}
          >
            تماس با {phone}
          </a>
        ) : (
          <Button
            disabled={pending}
            onClick={() => {
              if (!account?.authenticated || !account.verified) {
                onRequestAccess(() => void revealPhone());
                return;
              }
              void revealPhone();
            }}
          >
            <Phone aria-hidden="true" className="size-4" />
            {pending ? "در حال دریافت شماره…" : "نمایش شماره تماس"}
          </Button>
        ))}
      {listing.source.outbound_policy === "direct_contact" &&
      !listing.is_responsible_submitter &&
      !listing.contact_blocked &&
      listing.can_reveal_phone ? (
        <p className="text-muted-foreground text-xs">
          شماره نمایش‌داده‌شده را نمی‌توان از کسی که آن را دیده پس گرفت.
        </p>
      ) : null}
      {listing.phone_reveal_unavailable_reason === "phone_unavailable" ? (
        <p className="text-muted-foreground text-sm">
          شماره تماس تأییدشده این آگهی در دسترس نیست.
        </p>
      ) : null}
      {listing.source.outbound_policy === "external_link" && (
        <Button
          disabled={pending}
          onClick={() => void continueExternally()}
          variant="outline"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          {pending ? "در حال انتقال…" : "ادامه در منبع اصلی"}
        </Button>
      )}
      {failed && (
        <p className="text-destructive text-sm" role="alert">
          مسیر ادامه این آگهی در دسترس نیست. دوباره تلاش کنید.
        </p>
      )}
    </div>
  );
}

function ListingInquiryComposer({
  listing,
  account,
  onClose,
  onNavigateMessage,
}: {
  listing: Listing;
  account?: ListingInquiryAccount;
  onClose: () => void;
  onNavigateMessage: (href: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = form.get("body");
    const displayName = form.get("display_name");
    if (typeof body !== "string" || !body.trim()) return;
    setPending(true);
    setFailed(false);
    try {
      if (!account?.displayName) {
        if (typeof displayName !== "string" || !displayName.trim()) return;
        await chooseDisplayName(displayName.trim());
      }
      const inquiry = await startListingInquiry(listing.id, body.trim());
      onNavigateMessage(inquiry.href);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <div className="grid gap-2 pe-10">
          <DialogTitle>پیام به ثبت‌کننده</DialogTitle>
          <DialogDescription>
            آگهی {listing.source.display_name} با ودیعه{" "}
            {formatNumber(listing.rental_terms.deposit_toman)} تومان
          </DialogDescription>
        </div>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          {!account?.displayName ? (
            <div className="grid gap-2">
              <Label htmlFor={`display-name-${listing.id}`}>نام نمایشی</Label>
              <input
                className="border-input h-11 rounded-md border px-3"
                id={`display-name-${listing.id}`}
                maxLength={120}
                name="display_name"
                required
              />
              <p className="text-muted-foreground text-sm">
                این نام برای گفت‌وگو نمایش داده می‌شود و هویت قانونی شما را
                تأیید نمی‌کند.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              پیام با نام نمایشی «{account.displayName}» ارسال می‌شود. این نام
              هویت قانونی تأییدشده نیست.
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`inquiry-body-${listing.id}`}>پیام نخست</Label>
            <textarea
              className="border-input min-h-32 rounded-md border p-3"
              id={`inquiry-body-${listing.id}`}
              maxLength={2000}
              name="body"
              required
            />
          </div>
          <Alert>
            <AlertDescription>
              شماره تماس و پیوند مجاز است؛ پیش از انتقال گفت‌وگو به خارج از
              ترب‌رنت، هویت طرف مقابل و خطرهای ارتباط خارج از سامانه را بررسی
              کنید.
            </AlertDescription>
          </Alert>
          {failed ? (
            <p className="text-destructive text-sm" role="alert">
              ارسال پیام انجام نشد. وضعیت حساب و آگهی را بررسی کنید.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} type="button" variant="ghost">
              انصراف
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? "در حال ارسال…" : "ارسال پیام"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PropertyDetailPage({
  property,
  returnTo,
  onNavigateExternal = (url) => window.location.assign(url),
  account,
  onRequestAccess = (intent) => intent(),
  onNavigateMessage = (href) => window.location.assign(href),
}: {
  property: PropertyDetail;
  returnTo?: string | null;
  onNavigateExternal?: (url: string) => void;
  account?: ListingInquiryAccount;
  onRequestAccess?: (intent: () => void) => void;
  onNavigateMessage?: (href: string) => void;
}) {
  const [composerListing, setComposerListing] = useState<Listing>();
  const openComposer = useCallback((listing: Listing) => {
    clearListingInquiryIntent();
    setComposerListing(listing);
  }, []);
  useEffect(() => {
    void recordPropertyView(property.id).catch(() => undefined);
  }, [property.id]);
  useEffect(() => {
    if (!account?.authenticated || !account.verified) return;
    const listingId = sessionStorage.getItem(LISTING_INQUIRY_INTENT_KEY);
    const listing = property.listings.find(
      (candidate) =>
        candidate.id === listingId && candidate.can_message_submitter,
    );
    if (!listing) return;
    const restore = window.setTimeout(() => openComposer(listing), 0);
    return () => window.clearTimeout(restore);
  }, [
    account?.authenticated,
    account?.verified,
    openComposer,
    property.listings,
  ]);
  const safeReturnTo = returnTo?.startsWith("/search") ? returnTo : "/search";
  const location = [
    property.location.city,
    property.location.district,
    property.location.neighborhood,
  ].join("، ");
  const facts = [
    {
      Icon: Ruler,
      label: "مساحت",
      value: `${formatNumber(property.area_sqm)} متر`,
    },
    {
      Icon: BedDouble,
      label: "تعداد اتاق",
      value:
        property.room_count == null
          ? "ثبت نشده"
          : `${formatNumber(property.room_count)} ${roomCountLabels[property.property_category].fact}`,
    },
    {
      Icon: Layers3,
      label: "طبقه",
      value:
        property.floor === null
          ? "ثبت نشده"
          : property.floor === 0
            ? "همکف"
            : `طبقه ${formatNumber(property.floor)}`,
    },
    {
      Icon: CalendarDays,
      label: "ساخت",
      value:
        property.construction_year === null
          ? "ثبت نشده"
          : `سال ساخت ${new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(property.construction_year)}`,
    },
  ];
  const buildingFacts = [
    {
      Icon: Building2,
      value:
        property.total_floors === null
          ? "تعداد طبقات ثبت نشده"
          : `${formatNumber(property.total_floors)} طبقه`,
    },
    {
      Icon: DoorOpen,
      value:
        property.units_per_floor === null
          ? "تعداد واحدها ثبت نشده"
          : `${formatNumber(property.units_per_floor)} واحد در هر طبقه`,
    },
    { Icon: Flame, value: `گرمایش: ${property.heating || "ثبت نشده"}` },
    { Icon: Snowflake, value: `سرمایش: ${property.cooling || "ثبت نشده"}` },
  ];

  return (
    <PageMain className="max-w-360 pb-12">
      <nav
        aria-label="مسیر صفحه"
        className="text-muted-foreground mb-6 flex items-center justify-between gap-3 text-sm"
      >
        <Button asChild variant="ghost" className="-ms-3">
          <a href={safeReturnTo}>
            <ArrowRight aria-hidden="true" />
            بازگشت به نتایج
          </a>
        </Button>
        <span>
          {property.property_type_label} در {property.location.city}
        </span>
      </nav>
      <header className="mb-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{property.property_category_label}</Badge>
          <Badge variant="outline">{property.property_type_label}</Badge>
          <span className="text-muted-foreground ms-1 text-xs">
            {formatNumber(property.listings.length)} آگهی فعال برای این ملک
          </span>
        </div>
        <h1 className="text-2xl leading-relaxed font-bold tracking-tight sm:text-4xl">
          {property.title}
        </h1>
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-sm">
          <MapPin className="text-primary size-4 shrink-0" aria-hidden="true" />
          {location}
        </p>
        <Button asChild className="mt-5 lg:hidden" variant="outline">
          <a href="#active-listings-title">
            <Wallet aria-hidden="true" className="size-4" />
            مشاهده قیمت‌ها و راه‌های ارتباط
          </a>
        </Button>
        <Button asChild variant="ghost" className="mt-3">
          <a href="#property-location">
            <MapPin aria-hidden="true" />
            مشاهده روی نقشه
          </a>
        </Button>
      </header>
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          <PropertyGallery key={property.id} property={property} />
          <dl className="bg-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl border sm:grid-cols-4">
            {facts.map(({ Icon, label, value }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-2 p-5 text-center"
              >
                <Icon
                  className="text-primary mb-1 size-6"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="text-sm font-bold sm:text-base">{value}</dd>
              </div>
            ))}
          </dl>
          <section
            aria-labelledby="normalized-facts-title"
            className="bg-card rounded-2xl border p-5 sm:p-7"
          >
            <h2
              id="normalized-facts-title"
              className="flex items-center gap-2 text-xl font-bold"
            >
              <BadgeCheck className="text-primary size-5" aria-hidden="true" />
              مشخصات تأییدشده ملک
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-7">
              امکانات و جزئیات ملک، یک‌جا برای بررسی و مقایسه
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(featureLabels).map(([feature, label]) => {
                const key = feature as keyof typeof featureLabels;
                const state = property.features[key];
                const Icon = featureIcons[key];
                const StateIcon =
                  state === "present"
                    ? Check
                    : state === "absent"
                      ? Minus
                      : CircleHelp;
                return (
                  <div
                    key={feature}
                    className={`flex items-center gap-3 rounded-xl border p-3 sm:p-4 ${state === "present" ? "border-primary/20 bg-primary/5" : "bg-muted/20 text-muted-foreground"}`}
                  >
                    <Icon
                      className={`size-5 shrink-0 ${state === "present" ? "text-primary" : ""}`}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    <span className="text-sm">
                      <span className="block font-medium">
                        {label}
                        <span className="sr-only">: </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs">
                        <StateIcon className="size-3" aria-hidden="true" />
                        {featureStateLabels[state]}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <ul className="mt-6 grid gap-4 border-t pt-6 sm:grid-cols-2">
              {buildingFacts.map(({ Icon, value }) => (
                <li key={value} className="flex items-center gap-3 text-sm">
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {value}
                </li>
              ))}
            </ul>
          </section>
          <PropertyLocationMap property={property} />
          <PropertyPriceHistory
            key={property.id + "-history"}
            listings={property.listings}
          />
        </div>
        <section
          aria-labelledby="active-listings-title"
          className="min-w-0 space-y-4 lg:sticky lg:top-6"
        >
          <div className="flex items-center justify-between">
            <h2 id="active-listings-title" className="text-xl font-bold">
              آگهی‌های فعال
            </h2>
            <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-sm font-semibold">
              {formatNumber(property.listings.length)}
            </span>
          </div>
          <p className="text-muted-foreground text-sm leading-7">
            قیمت و شرایط هر منبع را بررسی کنید و مستقیم ادامه دهید.
          </p>
          {property.listings.length === 0 && (
            <p className="bg-muted rounded-xl p-5 text-sm">
              در حال حاضر آگهی فعالی برای این ملک وجود ندارد.
            </p>
          )}
          {property.listings.map((listing, index) => (
            <Card
              className={`overflow-hidden rounded-2xl py-0 shadow-none ${index === 0 ? "border-primary/25" : ""}`}
              key={listing.id}
            >
              <article aria-label={`آگهی ${listing.source.display_name}`}>
                <CardHeader className="bg-muted/30 gap-4 border-b p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold">
                      {listing.source.display_name}
                    </span>
                    <Badge
                      variant="outline"
                      className="bg-background gap-1.5 text-xs"
                    >
                      <span className="bg-primary size-1.5 rounded-full" />
                      فعال
                    </Badge>
                  </div>
                  <div className="bg-background grid gap-4 rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Wallet className="size-4" aria-hidden="true" />
                        ودیعه
                      </span>
                      <p className="text-lg font-bold tabular-nums">
                        {formatNumber(listing.rental_terms.deposit_toman)}{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          تومان
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t pt-4">
                      <span className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Banknote className="size-4" aria-hidden="true" />
                        اجاره ماهانه
                      </span>
                      <p className="text-lg font-bold tabular-nums">
                        {formatNumber(listing.rental_terms.monthly_rent_toman)}{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          تومان
                        </span>
                      </p>
                    </div>
                  </div>
                  {(listing.is_convertible || listing.is_negotiable) && (
                    <div className="flex flex-wrap gap-2">
                      {listing.is_convertible && (
                        <Badge variant="secondary">قابل تبدیل</Badge>
                      )}
                      {listing.is_negotiable && (
                        <Badge variant="secondary">قابل مذاکره</Badge>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {listing.description && (
                    <div>
                      <h3 className="text-muted-foreground mb-2 text-xs">
                        توضیحات آگهی
                      </h3>
                      <p className="text-sm leading-8 [overflow-wrap:anywhere] whitespace-pre-line">
                        {listing.description}
                      </p>
                    </div>
                  )}
                  {listing.disagreements.length > 0 && (
                    <section className="bg-muted/60 rounded-xl border p-3">
                      <h3 className="text-sm font-semibold">
                        اختلاف با مشخصات تأییدشده
                      </h3>
                      <ul className="text-muted-foreground mt-2 space-y-2 text-xs leading-6">
                        {listing.disagreements.map((disagreement) => (
                          <li
                            key={disagreement.field}
                          >{`${sourceClaimLabels[disagreement.field] ?? disagreement.field}: منبع ${formatClaimValue(disagreement.source_value)}، تأییدشده ${formatClaimValue(disagreement.normalized_value)}`}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <p className="text-muted-foreground flex items-center gap-2 text-xs leading-6">
                    <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                    آخرین تأیید موجودی:{" "}
                    <time dateTime={listing.availability_confirmed_at}>
                      {formatFreshness(listing.availability_confirmed_at)}
                    </time>
                  </p>
                  <div className="border-t pt-4">
                    <ListingContinuation
                      listing={listing}
                      onNavigateExternal={onNavigateExternal}
                      account={account}
                      onCompose={() => openComposer(listing)}
                      onRequestAccess={onRequestAccess}
                    />
                  </div>
                </CardContent>
              </article>
            </Card>
          ))}
        </section>
      </div>
      {composerListing ? (
        <ListingInquiryComposer
          account={account}
          listing={composerListing}
          onClose={() => setComposerListing(undefined)}
          onNavigateMessage={onNavigateMessage}
        />
      ) : null}
    </PageMain>
  );
}

export default PropertyDetailPage;
