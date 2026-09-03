import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Building2, Clock3, MapPin } from "lucide-react";

import { PageMain } from "@/components/layout/PageMain";
import { roomCountLabels } from "@/features/catalog/property-taxonomy";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-2">
      {listing.is_responsible_submitter ? (
        <p className="bg-muted rounded-md px-3 py-2 text-sm font-semibold">
          این آگهی شماست
        </p>
      ) : null}
      {listing.can_message_submitter ? (
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
          پیام به ثبت‌کننده
        </Button>
      ) : null}
      {listing.source.outbound_policy === "direct_contact" &&
        !listing.is_responsible_submitter &&
        (phone ? (
          <a
            className="text-primary inline-flex min-h-11 items-center font-semibold"
            href={`tel:${phone}`}
          >
            تماس با {phone}
          </a>
        ) : (
          <Button disabled={pending} onClick={() => void revealPhone()}>
            {pending ? "در حال دریافت شماره…" : "نمایش شماره تماس"}
          </Button>
        ))}
      {listing.source.outbound_policy === "external_link" && (
        <Button
          disabled={pending}
          onClick={() => void continueExternally()}
          variant="link"
        >
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
    `${formatNumber(property.area_sqm)} متر`,
    property.room_count === null || property.room_count === undefined
      ? null
      : `${formatNumber(property.room_count)} ${roomCountLabels[property.property_category].fact}`,
    property.floor === null ? null : `طبقه ${formatNumber(property.floor)}`,
    property.construction_year === null
      ? null
      : `سال ساخت ${formatNumber(property.construction_year)}`,
    property.total_floors === null
      ? null
      : `${formatNumber(property.total_floors)} طبقه`,
    property.units_per_floor === null
      ? null
      : `${formatNumber(property.units_per_floor)} واحد در هر طبقه`,
    property.heating ? `گرمایش: ${property.heating}` : null,
    property.cooling ? `سرمایش: ${property.cooling}` : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <PageMain>
      <Button asChild className="mb-6" variant="ghost">
        <a href={safeReturnTo}>
          <ArrowRight aria-hidden="true" /> بازگشت به نتایج
        </a>
      </Button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <div>
          <div className="bg-muted text-muted-foreground flex aspect-[16/9] items-center justify-center rounded-xl">
            <div className="flex flex-col items-center gap-3 px-4 text-center text-sm">
              <Building2 className="size-12" aria-hidden="true" />
              تصویر مجازی برای این ملک منتشر نشده است
            </div>
          </div>
          <header className="py-7">
            <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm">
              <MapPin className="size-4" aria-hidden="true" />
              {location}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {property.title}
            </h1>
            <ul className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </header>

          <section aria-labelledby="normalized-facts-title">
            <h2
              id="normalized-facts-title"
              className="text-2xl font-semibold tracking-tight"
            >
              مشخصات تأییدشده ملک
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(featureLabels).map(([feature, label]) => {
                const state =
                  property.features[feature as keyof typeof featureLabels];
                return (
                  <Badge key={feature} variant="outline">
                    {label}: {featureStateLabels[state]}
                  </Badge>
                );
              })}
            </div>
          </section>
        </div>

        <section aria-labelledby="active-listings-title">
          <h2
            id="active-listings-title"
            className="mb-4 text-2xl font-semibold tracking-tight"
          >
            آگهی‌های فعال
          </h2>
          <div className="space-y-4">
            {property.listings.map((listing) => (
              <Card className="shadow-none" key={listing.id}>
                <article aria-label={`آگهی ${listing.source.display_name}`}>
                  <CardHeader>
                    <Badge variant="secondary" className="w-fit">
                      {listing.source.display_name}
                    </Badge>
                    <p className="text-lg font-semibold">
                      ودیعه {formatNumber(listing.rental_terms.deposit_toman)}{" "}
                      تومان
                    </p>
                    <p>
                      اجاره ماهانه{" "}
                      {formatNumber(listing.rental_terms.monthly_rent_toman)}{" "}
                      تومان
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {listing.media_url && (
                      <img
                        className="aspect-video w-full rounded-lg object-cover"
                        src={listing.media_url}
                        alt={`تصویر آگهی ${listing.source.display_name}`}
                      />
                    )}
                    {listing.description && <p>{listing.description}</p>}
                    {listing.disagreements.length > 0 && (
                      <section className="bg-muted rounded-lg p-3">
                        <h3 className="text-sm font-semibold">
                          اختلاف با مشخصات تأییدشده
                        </h3>
                        <ul className="mt-2 space-y-1 text-sm">
                          {listing.disagreements.map((disagreement) => (
                            <li key={disagreement.field}>
                              {`${sourceClaimLabels[disagreement.field] ?? disagreement.field}: منبع ${formatClaimValue(disagreement.source_value)}، تأییدشده ${formatClaimValue(disagreement.normalized_value)}`}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    <p className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Clock3 className="size-4" aria-hidden="true" />
                      آخرین تأیید موجودی:{" "}
                      <time dateTime={listing.availability_confirmed_at}>
                        {formatFreshness(listing.availability_confirmed_at)}
                      </time>
                    </p>
                    <ListingContinuation
                      listing={listing}
                      onNavigateExternal={onNavigateExternal}
                      account={account}
                      onCompose={() => openComposer(listing)}
                      onRequestAccess={onRequestAccess}
                    />
                  </CardContent>
                </article>
              </Card>
            ))}
          </div>
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
