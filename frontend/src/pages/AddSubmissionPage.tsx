import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Save, ArrowLeft, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AccountWorkspace } from "@/features/account/AccountWorkspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { locationAutocompleteQueryOptions } from "@/features/catalog/queries";
import { ExactLocationPicker } from "@/features/map/ExactLocationPicker";
import { normalizeNumericEntry } from "@/features/catalog/numeric-entry";
import {
  propertyCategoryForType,
  propertyTypeGroups,
  propertyTypeLabels,
  roomCountLabels,
  type PropertyType,
} from "@/features/catalog/property-taxonomy";
import {
  SubmissionImagesFields,
  submissionImagePreview,
} from "@/features/submissions/SubmissionImagesFields";
import {
  createSubmission,
  requestAlternateContactVerification,
  saveSubmissionStep,
  submitSubmission,
  submissionQueryOptions,
  type Submission,
  type SubmissionStepUpdate,
  verifyAlternateContact,
} from "@/features/submissions/queries";
import {
  phonePublicationConsentCopy,
  submissionAuthorizationCopy,
} from "@/features/submissions/consent-copy";
import {
  submissionSteps as steps,
  type SubmissionStepId as StepId,
} from "@/features/submissions/steps";
import { ApiError, errorMessage } from "@/lib/api/errors";

const featureStates = [
  { value: "present", label: "دارد" },
  { value: "absent", label: "ندارد" },
  { value: "unknown", label: "نمی‌دانم" },
] as const;

const featureLabels = {
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
} as const;

const stepDescriptions: Record<StepId, string> = {
  location:
    "محله و نشانی را وارد کنید. نشانی دقیق و موقعیت ساختمان عمومی نمی‌شود.",
  property_facts:
    "نوع و مشخصات ملک را وارد کنید تا متقاضیان راحت‌تر آن را پیدا کنند.",
  rental_terms:
    "مبلغ‌ها را به تومان بنویسید. برای رهن کامل، اجاره ماهانه را صفر وارد کنید.",
  features_description:
    "امکانات ملک را مشخص کنید و ویژگی‌های دیگر را در توضیحات بنویسید.",
  images:
    "تصاویر روشن و واضح اضافه کنید و بهترین عکس را به‌عنوان تصویر اصلی انتخاب کنید.",
  contact:
    "نام و شماره تماس آگهی را مشخص و اجازه نمایش عمومی شماره را تأیید کنید.",
  review:
    "اطلاعات زیر را بررسی کنید. پس از ارسال، آگهی برای بررسی در صف قرار می‌گیرد.",
};

const persianStepNumbers = ["۱", "۲", "۳", "۴", "۵", "۶", "۷"] as const;

type ValidationState = {
  message: string;
  fields: Record<string, string>;
};

function fieldMessage(
  validation: ValidationState | undefined,
  ...fields: string[]
) {
  return fields.map((field) => validation?.fields[field]).find(Boolean);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  ) : null;
}

function numericValue(form: FormData, name: string) {
  const normalized = normalizeNumericEntry(formValue(form, name));
  return normalized === "" ? Number.NaN : Number(normalized);
}

function formValue(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function reviewAccuracyConfirmed(review: unknown) {
  return Boolean(
    review &&
    typeof review === "object" &&
    "accuracy_confirmed" in review &&
    review.accuracy_confirmed,
  );
}

function RoleChooser({
  onCreated,
  resumeExisting,
}: {
  onCreated: (draft: Submission) => void;
  resumeExisting: boolean;
}) {
  const [role, setRole] = useState<"owner" | "agent">("owner");
  const mutation = useMutation({
    mutationFn: () => createSubmission(role, resumeExisting),
    onSuccess: onCreated,
  });

  return (
    <Card className="mx-auto max-w-2xl shadow-none">
      <CardHeader>
        <h2 className="text-xl font-semibold">نقش شما در این ثبت چیست؟</h2>
        <p className="text-muted-foreground text-sm">
          این انتخاب فقط برای همین آگهی ذخیره می‌شود.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={role}
          onValueChange={(value) => setRole(value as "owner" | "agent")}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Label className="border-border has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border px-4">
            <RadioGroupItem value="owner" /> مالک ملک هستم
          </Label>
          <Label className="border-border has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border px-4">
            <RadioGroupItem value="agent" /> نماینده مالک هستم
          </Label>
        </RadioGroup>
        {mutation.isError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {errorMessage(mutation.error, "ساخت پیش‌نویس ممکن نشد.")}
            </AlertDescription>
          </Alert>
        )}
        <Button
          className="rounded-full"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "در حال آماده‌سازی…" : "ساخت یا ادامه پیش‌نویس"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LocationFields({
  submission,
  validation,
  onDirty,
}: {
  submission: Submission;
  validation?: ValidationState;
  onDirty: () => void;
}) {
  const [query, setQuery] = useState(submission.location?.neighborhood ?? "");
  const [selectedId, setSelectedId] = useState(
    submission.location?.neighborhood_id ?? "",
  );
  const [exactLocation, setExactLocation] = useState(
    submission.location?.exact_location
      ? {
          latitude: Number(submission.location.exact_location.latitude),
          longitude: Number(submission.location.exact_location.longitude),
        }
      : null,
  );
  const suggestions = useQuery(locationAutocompleteQueryOptions(query));
  const neighborhoodError = fieldMessage(
    validation,
    "location.neighborhood_id",
    "location.non_field_errors",
  );
  const addressError = fieldMessage(validation, "location.address");

  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <Label htmlFor="location-query">محله</Label>
        <Input
          id="location-query"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId("");
          }}
          autoComplete="off"
          aria-invalid={Boolean(neighborhoodError)}
          aria-describedby={
            neighborhoodError ? "location-error" : "location-help"
          }
        />
        <p id="location-help" className="text-muted-foreground text-xs">
          نام محله را بنویسید و یکی از پیشنهادها را انتخاب کنید.
        </p>
        <FieldError id="location-error" message={neighborhoodError} />
        {suggestions.data && suggestions.data.length > 0 && !selectedId && (
          <div className="border-border grid rounded-lg border" role="listbox">
            {suggestions.data
              .filter((item) => item.kind === "neighborhood")
              .map((item) => (
                <button
                  className="hover:bg-muted min-h-11 px-3 text-start text-sm"
                  key={item.id}
                  role="option"
                  aria-selected={false}
                  type="button"
                  onClick={() => {
                    setQuery(item.label);
                    setSelectedId(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
          </div>
        )}
        <input name="neighborhood_id" type="hidden" value={selectedId} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">نشانی دقیق</Label>
        <Input
          id="address"
          name="address"
          defaultValue={submission.location?.address}
          aria-invalid={Boolean(addressError)}
          aria-describedby={addressError ? "address-error" : undefined}
        />
        <FieldError id="address-error" message={addressError} />
      </div>
      <p className="text-muted-foreground bg-muted flex items-start gap-2 rounded-xl p-4 text-sm leading-6">
        <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
        نشانی دقیق فقط برای بررسی استفاده می‌شود؛ متقاضیان موقعیت تقریبی ملک را
        می‌بینند.
      </p>
      <ExactLocationPicker
        value={exactLocation ?? { latitude: 35.7219, longitude: 51.3347 }}
        onChange={(location) => {
          setExactLocation(location);
          onDirty();
        }}
      />
      <input
        name="exact_latitude"
        type="hidden"
        value={exactLocation?.latitude ?? ""}
      />
      <input
        name="exact_longitude"
        type="hidden"
        value={exactLocation?.longitude ?? ""}
      />
    </div>
  );
}

function PropertyFactsFields({
  submission,
  validation,
}: {
  submission: Submission;
  validation?: ValidationState;
}) {
  const facts = submission.property_facts;
  const [propertyType, setPropertyType] = useState<PropertyType>(
    facts?.property_type ?? "apartment",
  );
  const propertyCategory = propertyCategoryForType(propertyType);
  const roomCountLabel = `${roomCountLabels[propertyCategory].field}${
    propertyCategory === "commercial" ? " (اختیاری)" : ""
  }`;
  const typeError = fieldMessage(validation, "property_facts.property_type");
  const areaError = fieldMessage(validation, "property_facts.area_sqm");
  const roomsError = fieldMessage(validation, "property_facts.room_count");
  const yearError = fieldMessage(
    validation,
    "property_facts.construction_year",
  );
  const floorError = fieldMessage(validation, "property_facts.floor");
  const floorsError = fieldMessage(validation, "property_facts.total_floors");
  const unitsError = fieldMessage(validation, "property_facts.units_per_floor");
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Label className="space-y-2">
        <span>نوع ملک</span>
        <select
          className="border-input bg-background min-h-11 w-full rounded-md border px-3"
          name="property_type"
          value={propertyType}
          onChange={(event) =>
            setPropertyType(event.target.value as PropertyType)
          }
          aria-invalid={Boolean(typeError)}
          aria-describedby={typeError ? "property-type-error" : undefined}
        >
          {propertyTypeGroups.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.types.map((type) => (
                <option key={type} value={type}>
                  {propertyTypeLabels[type]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError id="property-type-error" message={typeError} />
      </Label>
      <div className="space-y-2">
        <Label htmlFor="area">متراژ</Label>
        <Input
          id="area"
          name="area_sqm"
          inputMode="numeric"
          defaultValue={facts?.area_sqm}
          aria-invalid={Boolean(areaError)}
          aria-describedby={areaError ? "area-error" : undefined}
        />
        <FieldError id="area-error" message={areaError} />
      </div>
      <Label className="space-y-2">
        <span>{roomCountLabel}</span>
        <Input
          name="room_count"
          aria-label={roomCountLabel}
          inputMode="numeric"
          defaultValue={facts?.room_count ?? ""}
          aria-invalid={Boolean(roomsError)}
          aria-describedby={roomsError ? "rooms-error" : undefined}
        />
        <FieldError id="rooms-error" message={roomsError} />
      </Label>
      <Label className="space-y-2">
        <span>سال ساخت</span>
        <Input
          name="construction_year"
          aria-label="سال ساخت"
          inputMode="numeric"
          defaultValue={facts?.construction_year ?? ""}
          aria-invalid={Boolean(yearError)}
          aria-describedby={yearError ? "year-error" : undefined}
        />
        <FieldError id="year-error" message={yearError} />
      </Label>
      <Label className="space-y-2">
        <span>طبقه</span>
        <Input
          name="floor"
          aria-label="طبقه"
          inputMode="numeric"
          defaultValue={facts?.floor ?? ""}
          aria-invalid={Boolean(floorError)}
          aria-describedby={floorError ? "floor-error" : undefined}
        />
        <FieldError id="floor-error" message={floorError} />
      </Label>
      <Label className="space-y-2">
        <span>تعداد کل طبقات</span>
        <Input
          name="total_floors"
          aria-label="تعداد کل طبقات"
          inputMode="numeric"
          defaultValue={facts?.total_floors ?? ""}
          aria-invalid={Boolean(floorsError)}
          aria-describedby={floorsError ? "floors-error" : undefined}
        />
        <FieldError id="floors-error" message={floorsError} />
      </Label>
      <Label className="space-y-2">
        <span>واحد در هر طبقه</span>
        <Input
          name="units_per_floor"
          aria-label="واحد در هر طبقه"
          inputMode="numeric"
          defaultValue={facts?.units_per_floor ?? ""}
          aria-invalid={Boolean(unitsError)}
          aria-describedby={unitsError ? "units-error" : undefined}
        />
        <FieldError id="units-error" message={unitsError} />
      </Label>
    </div>
  );
}

function RentalTermsFields({
  submission,
  validation,
}: {
  submission: Submission;
  validation?: ValidationState;
}) {
  const terms = submission.rental_terms;
  const sharedError = fieldMessage(validation, "rental_terms.non_field_errors");
  const depositError =
    fieldMessage(validation, "rental_terms.deposit_toman") ?? sharedError;
  const rentError =
    fieldMessage(validation, "rental_terms.monthly_rent_toman") ?? sharedError;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="deposit">ودیعه، تومان</Label>
        <Input
          id="deposit"
          name="deposit_toman"
          inputMode="numeric"
          defaultValue={terms?.deposit_toman}
          aria-invalid={Boolean(depositError)}
          aria-describedby={depositError ? "deposit-error" : undefined}
        />
        <FieldError id="deposit-error" message={depositError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rent">اجاره ماهانه، تومان</Label>
        <Input
          id="rent"
          name="monthly_rent_toman"
          inputMode="numeric"
          defaultValue={terms?.monthly_rent_toman}
          aria-invalid={Boolean(rentError)}
          aria-describedby={rentError ? "rent-error" : undefined}
        />
        <FieldError id="rent-error" message={rentError} />
      </div>
      <Label className="flex min-h-11 items-center gap-3">
        <input
          name="is_negotiable"
          type="checkbox"
          defaultChecked={terms?.is_negotiable}
        />
        قابل مذاکره است
      </Label>
      <Label className="flex min-h-11 items-center gap-3">
        <input
          name="is_convertible"
          type="checkbox"
          defaultChecked={terms?.is_convertible}
        />
        ودیعه و اجاره قابل تبدیل است
      </Label>
    </div>
  );
}

function FeaturesFields({
  submission,
  validation,
}: {
  submission: Submission;
  validation?: ValidationState;
}) {
  return (
    <div className="grid gap-6">
      {Object.entries(featureLabels).map(([name, label]) => {
        const error = fieldMessage(validation, `features.${name}`);
        return (
          <fieldset key={name} aria-invalid={Boolean(error)}>
            <legend className="mb-3 text-sm font-medium">وضعیت {label}</legend>
            <RadioGroup
              name={name}
              className="grid gap-3 sm:grid-cols-3"
              defaultValue={
                submission.features?.[name as keyof typeof featureLabels] ??
                "unknown"
              }
            >
              {featureStates.map((state) => (
                <Label
                  className="border-border flex min-h-11 items-center gap-3 rounded-lg border px-4"
                  key={state.value}
                >
                  <RadioGroupItem value={state.value} /> {state.label}
                </Label>
              ))}
            </RadioGroup>
            <FieldError id={`${name}-error`} message={error} />
          </fieldset>
        );
      })}
      <Label className="space-y-2">
        <span>توضیحات</span>
        <textarea
          className="border-input min-h-32 w-full rounded-md border p-3"
          name="description"
          defaultValue={submission.description}
        />
      </Label>
    </div>
  );
}

function ContactFields({
  submission,
  validation,
}: {
  submission: Submission;
  validation?: ValidationState;
}) {
  const queryClient = useQueryClient();
  const initialSource = submission.contact?.phone_source ?? "account";
  const accountPhone =
    submission.contact?.account_phone ?? submission.contact?.phone ?? "";
  const [phoneSource, setPhoneSource] = useState<"account" | "alternate">(
    initialSource,
  );
  const [alternatePhone, setAlternatePhone] = useState(
    initialSource === "alternate" ? (submission.contact?.phone ?? "") : "",
  );
  const [alternateVerified, setAlternateVerified] = useState(
    initialSource === "alternate" &&
      Boolean(submission.contact?.phone_verified),
  );
  const [otp, setOtp] = useState("");
  const [developmentOtp, setDevelopmentOtp] = useState<string>();
  const [verificationMessage, setVerificationMessage] = useState<string>();
  const [publicationConsent, setPublicationConsent] = useState(
    Boolean(submission.contact?.phone_publication_consent),
  );
  const requestVerification = useMutation({
    mutationFn: () =>
      requestAlternateContactVerification(submission.id, alternatePhone),
    onSuccess: (response) => {
      setAlternateVerified(false);
      setPublicationConsent(false);
      setOtp("");
      setDevelopmentOtp(response.development_otp);
      setVerificationMessage(
        response.development_otp
          ? undefined
          : "اگر شماره قابل تأیید باشد، کد تازه ارسال شده است.",
      );
    },
    onError: (error) =>
      setVerificationMessage(errorMessage(error, "ارسال کد تأیید ناموفق بود.")),
  });
  const verifyContact = useMutation({
    mutationFn: () => verifyAlternateContact(submission.id, otp),
    onSuccess: (saved) => {
      queryClient.setQueryData(["submissions", submission.id], saved);
      setAlternatePhone(saved.contact?.phone ?? alternatePhone);
      setAlternateVerified(true);
      setVerificationMessage("شماره دیگر تأیید شد.");
    },
    onError: (error) =>
      setVerificationMessage(errorMessage(error, "کد تأیید پذیرفته نشد.")),
  });
  const nameError = fieldMessage(validation, "contact.name");
  const phoneError = fieldMessage(validation, "contact.phone");
  const authorizationError = fieldMessage(
    validation,
    "contact.authorization_declared",
  );
  const consentError = fieldMessage(
    validation,
    "contact.phone_publication_consent",
  );
  return (
    <div className="grid gap-5">
      <Label className="space-y-2">
        <span>نام تماس</span>
        <Input
          name="name"
          aria-label="نام تماس"
          defaultValue={submission.contact?.name}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "contact-name-error" : undefined}
        />
        <FieldError id="contact-name-error" message={nameError} />
      </Label>
      <fieldset className="grid gap-3" aria-invalid={Boolean(phoneError)}>
        <legend className="text-sm font-medium">شماره عمومی تماس</legend>
        <RadioGroup
          name="phone_source"
          value={phoneSource}
          onValueChange={(value) => {
            const nextSource = value as "account" | "alternate";
            if (nextSource !== phoneSource) setPublicationConsent(false);
            setPhoneSource(nextSource);
            setVerificationMessage(undefined);
          }}
        >
          <Label className="border-border flex min-h-11 items-center gap-3 rounded-lg border px-4">
            <RadioGroupItem value="account" />
            استفاده از شماره تأییدشده حساب ({accountPhone})
          </Label>
          <Label className="border-border flex min-h-11 items-center gap-3 rounded-lg border px-4">
            <RadioGroupItem value="alternate" /> استفاده از شماره دیگر
          </Label>
        </RadioGroup>
        {phoneSource === "account" ? (
          <>
            <Input
              name="phone"
              aria-label="شماره عمومی تماس"
              inputMode="tel"
              value={accountPhone}
              readOnly
            />
            <p className="text-muted-foreground text-xs">
              این همان شماره تأییدشده حساب شماست و Renterها آن را در Direct
              Listing خواهند دید.
            </p>
          </>
        ) : (
          <div className="grid gap-3 rounded-lg border p-4">
            <Label className="space-y-2">
              <span>شماره دیگر</span>
              <Input
                name="phone"
                aria-label="شماره دیگر"
                inputMode="tel"
                value={alternatePhone}
                onChange={(event) => {
                  setAlternatePhone(event.target.value);
                  setAlternateVerified(false);
                  setPublicationConsent(false);
                  setVerificationMessage(undefined);
                }}
              />
            </Label>
            <Button
              type="button"
              variant="outline"
              disabled={!alternatePhone || requestVerification.isPending}
              onClick={() => requestVerification.mutate()}
            >
              {requestVerification.isPending
                ? "در حال ارسال…"
                : "ارسال کد تأیید"}
            </Button>
            {developmentOtp && (
              <p className="text-muted-foreground text-xs">
                کد توسعه: {developmentOtp}
              </p>
            )}
            {!alternateVerified &&
              (developmentOtp || requestVerification.isSuccess) && (
                <div className="grid gap-3">
                  <Label className="space-y-2">
                    <span>کد تأیید شماره دیگر</span>
                    <Input
                      aria-label="کد تأیید شماره دیگر"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                    />
                  </Label>
                  <Button
                    type="button"
                    disabled={otp.length !== 6 || verifyContact.isPending}
                    onClick={() => verifyContact.mutate()}
                  >
                    {verifyContact.isPending ? "در حال بررسی…" : "تأیید شماره"}
                  </Button>
                </div>
              )}
            <p className="text-muted-foreground text-xs">
              کد ۵ دقیقه اعتبار دارد؛ پس از ۵ تلاش ناموفق باید کد تازه‌ای
              درخواست کنید. ارسال دوباره پس از ۶۰ ثانیه ممکن است.
            </p>
            {verificationMessage && (
              <p role="status" className="text-sm">
                {verificationMessage}
              </p>
            )}
          </div>
        )}
        <FieldError id="contact-phone-error" message={phoneError} />
      </fieldset>
      <Label className="flex min-h-11 items-start gap-3">
        <input
          name="authorization_declared"
          type="checkbox"
          defaultChecked={submission.contact?.authorization_declared}
          aria-invalid={Boolean(authorizationError)}
          aria-describedby={
            authorizationError ? "authorization-error" : undefined
          }
        />
        {submissionAuthorizationCopy}
        <FieldError id="authorization-error" message={authorizationError} />
      </Label>
      <Label className="flex min-h-11 items-start gap-3">
        <input
          name="phone_publication_consent"
          type="checkbox"
          checked={publicationConsent}
          onChange={(event) => setPublicationConsent(event.target.checked)}
          aria-invalid={Boolean(consentError)}
          aria-describedby={consentError ? "consent-error" : undefined}
        />
        {phonePublicationConsentCopy}
        <FieldError id="consent-error" message={consentError} />
      </Label>
    </div>
  );
}

function StepFields({
  step,
  submission,
  validation,
  onDirty,
}: {
  step: StepId;
  submission: Submission;
  validation?: ValidationState;
  onDirty: () => void;
}) {
  if (step === "location") {
    return (
      <LocationFields
        submission={submission}
        validation={validation}
        onDirty={onDirty}
      />
    );
  }
  if (step === "property_facts") {
    return (
      <PropertyFactsFields submission={submission} validation={validation} />
    );
  }
  if (step === "rental_terms") {
    return (
      <RentalTermsFields submission={submission} validation={validation} />
    );
  }
  if (step === "features_description") {
    return <FeaturesFields submission={submission} validation={validation} />;
  }
  if (step === "images") {
    return <SubmissionImagesFields submission={submission} />;
  }
  if (step === "contact") {
    return <ContactFields submission={submission} validation={validation} />;
  }
  const reviewError = fieldMessage(validation, "review.accuracy_confirmed");
  return (
    <div className="space-y-5">
      <dl className="bg-muted grid gap-4 rounded-xl p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">مکان</dt>
          <dd>{submission.location?.neighborhood ?? "هنوز ثبت نشده"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">شرایط اجاره</dt>
          <dd>
            {submission.rental_terms
              ? `${submission.rental_terms.deposit_toman.toLocaleString("fa-IR")} تومان ودیعه`
              : "هنوز ثبت نشده"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">اجاره ماهانه</dt>
          <dd>
            {submission.rental_terms
              ? `${submission.rental_terms.monthly_rent_toman.toLocaleString("fa-IR")} تومان`
              : "هنوز ثبت نشده"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">نوع و متراژ ملک</dt>
          <dd>
            {submission.property_facts
              ? `${propertyTypeLabels[submission.property_facts.property_type]} · ${submission.property_facts.area_sqm.toLocaleString("fa-IR")} متر مربع`
              : "هنوز ثبت نشده"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">نشانی دقیق (غیرعمومی)</dt>
          <dd>{submission.location?.address || "هنوز ثبت نشده"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">نام و شماره تماس آگهی</dt>
          <dd>
            {submission.contact?.name || "هنوز ثبت نشده"}
            <bdi className="mt-1 block">{submission.contact?.phone}</bdi>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">امکانات</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {Object.entries(featureLabels).map(([key, label]) => (
              <Badge key={key} variant="outline">
                {label}:{" "}
                {featureStates.find(
                  (state) =>
                    state.value ===
                    submission.features?.[key as keyof typeof featureLabels],
                )?.label ?? "نمی‌دانم"}
              </Badge>
            ))}
          </dd>
        </div>
        {submission.description && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">توضیحات</dt>
            <dd className="mt-1 leading-7 break-words whitespace-pre-wrap">
              {submission.description}
            </dd>
          </div>
        )}
      </dl>
      {submission.images.length > 0 && (
        <section className="space-y-3" aria-labelledby="review-images-heading">
          <h3 id="review-images-heading" className="font-semibold">
            تصاویر
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {submission.images
              .filter((image) => image.status === "ready")
              .map((image) => {
                const preview = submissionImagePreview(image);
                return preview ? (
                  <figure key={image.id}>
                    <img
                      className="aspect-4/3 w-full rounded-lg object-cover"
                      src={preview.url}
                      alt="تصویر ملک در بازبینی"
                    />
                    {image.is_primary && (
                      <figcaption className="mt-1 text-xs">
                        تصویر اصلی
                      </figcaption>
                    )}
                  </figure>
                ) : null;
              })}
          </div>
        </section>
      )}
      <Label className="flex min-h-11 items-start gap-3">
        <input
          name="accuracy_confirmed"
          type="checkbox"
          defaultChecked={reviewAccuracyConfirmed(submission.review)}
          aria-invalid={Boolean(reviewError)}
          aria-describedby={reviewError ? "review-error" : undefined}
        />
        اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.
        <FieldError id="review-error" message={reviewError} />
      </Label>
      <Alert>
        <AlertDescription>
          {submission.media_complete
            ? "تصاویر آماده‌اند و این پیش‌نویس می‌تواند برای بررسی ارسال شود."
            : "برای ادامه، مرحله تصاویر را کامل کنید."}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function stepPayload(
  step: StepId,
  form: FormData,
): SubmissionStepUpdate | null {
  if (step === "images") return { completed_step: "images" };
  if (step === "location") {
    const latitude = numericValue(form, "exact_latitude");
    const longitude = numericValue(form, "exact_longitude");
    return {
      completed_step: step,
      location: {
        neighborhood_id: formValue(form, "neighborhood_id"),
        address: formValue(form, "address"),
        ...(!Number.isNaN(latitude) && !Number.isNaN(longitude)
          ? {
              exact_location: {
                latitude: String(latitude),
                longitude: String(longitude),
              },
            }
          : {}),
      },
    };
  }
  if (step === "property_facts") {
    const optionalNumber = (name: string) => {
      const value = numericValue(form, name);
      return Number.isNaN(value) ? null : value;
    };
    return {
      completed_step: step,
      property_facts: {
        property_type: formValue(form, "property_type") as PropertyType,
        area_sqm: numericValue(form, "area_sqm"),
        room_count: optionalNumber("room_count"),
        construction_year: optionalNumber("construction_year"),
        floor: optionalNumber("floor"),
        total_floors: optionalNumber("total_floors"),
        units_per_floor: optionalNumber("units_per_floor"),
      },
    };
  }
  if (step === "rental_terms") {
    return {
      completed_step: step,
      rental_terms: {
        deposit_toman: numericValue(form, "deposit_toman"),
        monthly_rent_toman: numericValue(form, "monthly_rent_toman"),
        is_negotiable: form.has("is_negotiable"),
        is_convertible: form.has("is_convertible"),
      },
    };
  }
  if (step === "features_description") {
    const state = (name: string) =>
      formValue(form, name) as "present" | "absent" | "unknown";
    return {
      completed_step: step,
      features: {
        parking: state("parking"),
        elevator: state("elevator"),
        storage: state("storage"),
        balcony: state("balcony"),
        furnished: state("furnished"),
      },
      description: formValue(form, "description"),
    };
  }
  if (step === "contact") {
    return {
      completed_step: step,
      contact: {
        name: formValue(form, "name"),
        phone: formValue(form, "phone"),
        phone_source: formValue(form, "phone_source") as
          "account" | "alternate",
        authorization_declared: form.has("authorization_declared"),
        phone_publication_consent: form.has("phone_publication_consent"),
      },
    };
  }
  return {
    completed_step: step,
    review: { accuracy_confirmed: form.has("accuracy_confirmed") },
  };
}

function DraftFlow({ submissionId }: { submissionId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const queryClient = useQueryClient();
  const submissionQuery = useQuery(submissionQueryOptions(submissionId));
  const [validation, setValidation] = useState<ValidationState>();
  const requestedStep = searchParams.get("step") as StepId | null;
  const submission = submissionQuery.data;
  const step = steps.some((item) => item.id === requestedStep)
    ? requestedStep!
    : (submission?.current_step ?? "location");
  const stepIndex = steps.findIndex((item) => item.id === step);
  const stepMeta = steps[stepIndex] ?? steps[0];
  const mutation = useMutation({
    mutationFn: async ({
      body,
      destination,
    }: {
      body: SubmissionStepUpdate;
      destination: string;
    }) => {
      const saved = await saveSubmissionStep(submissionId, body);
      if (body.completed_step === "review" && destination === "continue") {
        return submitSubmission(submissionId);
      }
      return saved;
    },
    onSuccess: (saved, { destination }) => {
      queryClient.setQueryData(["submissions", submissionId], saved);
      void queryClient.invalidateQueries({
        queryKey: ["submissions"],
        exact: true,
      });
      setDirty(false);
      if (destination === "exit") {
        void navigate("/dashboard");
        return;
      }
      if (destination !== "continue") {
        setValidation(undefined);
        setSearchParams({ submission: submissionId, step: destination });
        return;
      }
      setValidation(undefined);
      if (stepIndex < steps.length - 1) {
        setSearchParams({
          submission: submissionId,
          step: steps[stepIndex + 1]!.id,
        });
      }
    },
    onError: (error) =>
      setValidation({
        message: errorMessage(error, "اطلاعات این مرحله را بررسی کنید."),
        fields: error instanceof ApiError ? error.fields : {},
      }),
  });

  if (submissionQuery.isPending) return <p>در حال بارگذاری پیش‌نویس…</p>;
  if (!submission)
    return <Alert variant="destructive">پیش‌نویس بارگذاری نشد.</Alert>;
  if (submission.state === "pending") {
    return (
      <Card className="mx-auto max-w-xl shadow-none">
        <CardContent className="space-y-4 text-center">
          <Check className="text-primary mx-auto size-10" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">در انتظار بررسی اپراتور</h1>
          <p className="text-muted-foreground">
            نسخه {(submission.revision ?? 1).toLocaleString("fa-IR")} ثبت شد و
            تا تصمیم اپراتور قابل ویرایش نیست.
          </p>
          <Button asChild variant="outline">
            <Link to="/dashboard">مشاهده وضعیت و تاریخچه</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ??
      "continue";
    if (destination !== "continue" && !dirty) {
      if (destination === "exit") void navigate("/dashboard");
      else setSearchParams({ submission: submissionId, step: destination });
      return;
    }
    const form = new FormData(event.currentTarget);
    const payload = stepPayload(step, form);
    if (
      step === "location" &&
      (!formValue(form, "neighborhood_id") ||
        !formValue(form, "address").trim())
    ) {
      const message = "محله و نشانی دقیق را وارد کنید.";
      setValidation({
        message,
        fields: {
          ...(!formValue(form, "neighborhood_id") && {
            "location.neighborhood_id": "یک محله از پیشنهادها انتخاب کنید.",
          }),
          ...(!formValue(form, "address").trim() && {
            "location.address": "نشانی دقیق الزامی است.",
          }),
        },
      });
      return;
    }
    if (
      step === "property_facts" &&
      (!Number.isSafeInteger(numericValue(form, "area_sqm")) ||
        numericValue(form, "area_sqm") <= 0)
    ) {
      const message = "متراژ باید بیشتر از صفر باشد.";
      setValidation({
        message,
        fields: { "property_facts.area_sqm": message },
      });
      return;
    }
    if (step === "rental_terms") {
      const deposit = numericValue(form, "deposit_toman");
      const rent = numericValue(form, "monthly_rent_toman");
      if (
        !Number.isSafeInteger(deposit) ||
        !Number.isSafeInteger(rent) ||
        deposit < 0 ||
        rent < 0 ||
        deposit > 900_719_925_474_099 ||
        rent > 900_719_925_474_099 ||
        (deposit === 0 && rent === 0)
      ) {
        const message =
          deposit === 0 && rent === 0
            ? "ودیعه و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند."
            : "مبلغ را به‌صورت عدد صحیح و نامنفی، در محدوده مجاز وارد کنید.";
        setValidation({
          message,
          fields: {
            "rental_terms.deposit_toman": message,
            "rental_terms.monthly_rent_toman": message,
          },
        });
        return;
      }
    }
    if (
      step === "contact" &&
      (!formValue(form, "name").trim() ||
        !formValue(form, "phone").trim() ||
        !form.has("authorization_declared") ||
        !form.has("phone_publication_consent"))
    ) {
      const message = "اطلاعات تماس و اعلام اختیار را کامل کنید.";
      setValidation({
        message,
        fields: {
          ...(!formValue(form, "name").trim() && {
            "contact.name": "نام تماس الزامی است.",
          }),
          ...(!formValue(form, "phone").trim() && {
            "contact.phone": "شماره تماس الزامی است.",
          }),
          ...(!form.has("authorization_declared") && {
            "contact.authorization_declared":
              "اعلام اختیار ثبت ملک الزامی است.",
          }),
          ...(!form.has("phone_publication_consent") && {
            "contact.phone_publication_consent":
              "نمایش عمومی شماره تماس را تأیید کنید.",
          }),
        },
      });
      return;
    }
    if (
      step === "review" &&
      destination === "continue" &&
      !form.has("accuracy_confirmed")
    ) {
      const message = "تأیید درستی اطلاعات الزامی است.";
      setValidation({
        message,
        fields: { "review.accuracy_confirmed": message },
      });
      return;
    }
    if (
      step === "images" &&
      (submission.images.length < 1 ||
        submission.images.length > 12 ||
        submission.images.some((image) => image.status !== "ready") ||
        submission.images.filter((image) => image.is_primary).length !== 1)
    ) {
      const message =
        submission.images.length < 1
          ? "برای ادامه دست‌کم یک تصویر اضافه کنید."
          : "صبر کنید پردازش همه تصاویر تمام شود و یک تصویر اصلی انتخاب کنید.";
      setValidation({ message, fields: { images: message } });
      return;
    }
    if (payload) mutation.mutate({ body: payload, destination });
  };

  const stepNavigation = (
    <nav aria-label="مراحل ثبت آگهی">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {steps.map((item, index) => (
          <li key={item.id}>
            <button
              type="submit"
              form="submission-form"
              name="destination"
              value={item.id}
              disabled={mutation.isPending || index === stepIndex}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-sm ${
                index === stepIndex
                  ? "bg-primary/10 text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              aria-current={index === stepIndex ? "step" : undefined}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${index === stepIndex ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {persianStepNumbers[index]}
              </span>
              {item.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground mt-4 text-xs leading-6">
        با رفتن به مرحله دیگر، اطلاعات این مرحله ذخیره می‌شود.
      </p>
    </nav>
  );
  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary" className="mb-3">
            <Save aria-hidden="true" />{" "}
            {mutation.isPending
              ? "در حال ذخیره…"
              : dirty
                ? "تغییرات ذخیره‌نشده"
                : "پیش‌نویس ذخیره شده"}
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            ثبت آگهی اجاره
          </h1>
          <p className="text-muted-foreground mt-2">
            مرحله {persianStepNumbers[stepIndex]} از ۷ · {stepMeta.label}
          </p>
        </div>
        <Button
          type="submit"
          form="submission-form"
          name="destination"
          value="exit"
          variant="outline"
          disabled={mutation.isPending}
        >
          <Save aria-hidden="true" />
          ذخیره و خروج
        </Button>
      </header>
      <div
        className="bg-muted mb-6 h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="مرحله کنونی ثبت آگهی"
        aria-valuemin={1}
        aria-valuemax={7}
        aria-valuenow={stepIndex + 1}
        aria-valuetext={`مرحله ${persianStepNumbers[stepIndex]} از ۷`}
      >
        <div
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[12rem_minmax(0,1fr)]">
        <div>
          <div className="hidden xl:block">{stepNavigation}</div>
          <details className="rounded-xl border p-3 xl:hidden">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
              نمایش مراحل ثبت آگهی · {stepMeta.label}
            </summary>
            {stepNavigation}
          </details>
        </div>
        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-tight">
              {stepMeta.label}
            </h2>
            <p className="text-muted-foreground text-sm">
              {stepDescriptions[step]}
            </p>
          </CardHeader>
          <CardContent>
            {validation && (
              <Alert className="mb-6" variant="destructive" role="alert">
                <AlertTitle>اطلاعات این مرحله را بررسی کنید</AlertTitle>
                <AlertDescription>{validation.message}</AlertDescription>
              </Alert>
            )}
            <form
              id="submission-form"
              onSubmit={submit}
              onChange={() => setDirty(true)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  event.target instanceof HTMLInputElement &&
                  event.target.type !== "checkbox" &&
                  event.target.type !== "radio"
                ) {
                  event.preventDefault();
                  event.currentTarget.requestSubmit(
                    event.currentTarget.querySelector<HTMLButtonElement>(
                      'button[value="continue"]',
                    ) ?? undefined,
                  );
                }
              }}
            >
              <fieldset
                disabled={mutation.isPending}
                className="min-w-0 space-y-7"
              >
                <StepFields
                  onDirty={() => setDirty(true)}
                  step={step}
                  submission={submission}
                  validation={validation}
                />
                <div className="flex flex-wrap justify-between gap-3 border-t pt-6">
                  {stepIndex > 0 ? (
                    <Button
                      type="submit"
                      name="destination"
                      value={steps[stepIndex - 1]!.id}
                      variant="outline"
                    >
                      مرحله قبل
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    disabled={mutation.isPending}
                    type="submit"
                    name="destination"
                    value="continue"
                  >
                    {mutation.isPending
                      ? "در حال ذخیره…"
                      : step === "review"
                        ? "ارسال برای بررسی"
                        : "ذخیره و ادامه"}
                    <ArrowLeft aria-hidden="true" />
                  </Button>
                </div>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function AddSubmissionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const submissionId = searchParams.get("submission");
  return (
    <AccountWorkspace>
      {submissionId ? (
        <DraftFlow
          key={`${submissionId}-${searchParams.get("step") ?? ""}`}
          submissionId={submissionId}
        />
      ) : (
        <>
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">
              ثبت آگهی اجاره
            </h1>
            <p className="text-muted-foreground mt-2">
              اطلاعات ملک را در هفت مرحله کوتاه تکمیل کنید. پس از تکمیل هر مرحله
              می‌توانید ذخیره کنید و بعداً ادامه دهید.
            </p>
          </header>
          <RoleChooser
            resumeExisting={!searchParams.has("new")}
            onCreated={(draft) =>
              setSearchParams({
                submission: draft.id,
                step: draft.current_step ?? "location",
              })
            }
          />
        </>
      )}
    </AccountWorkspace>
  );
}

export default AddSubmissionPage;
