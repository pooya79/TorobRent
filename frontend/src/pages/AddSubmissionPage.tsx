import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, ImagePlus, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { locationAutocompleteQueryOptions } from "@/features/catalog/queries";
import { normalizeNumericEntry } from "@/features/catalog/numeric-entry";
import {
  createSubmission,
  saveSubmissionStep,
  submissionQueryOptions,
  type Submission,
  type SubmissionStepUpdate,
} from "@/features/submissions/queries";
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
}: {
  onCreated: (draft: Submission) => void;
}) {
  const [role, setRole] = useState<"owner" | "agent">("owner");
  const mutation = useMutation({
    mutationFn: () => createSubmission(role),
    onSuccess: onCreated,
  });

  return (
    <Card className="mx-auto max-w-2xl shadow-none">
      <CardHeader>
        <h2 className="text-xl font-semibold">نقش شما در این ثبت چیست؟</h2>
        <p className="text-muted-foreground text-sm">
          این انتخاب فقط برای همین Submission ذخیره می‌شود.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup
          value={role}
          onValueChange={(value) => setRole(value as "owner" | "agent")}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Label className="border-border flex min-h-12 items-center gap-3 rounded-lg border px-4">
            <RadioGroupItem value="owner" /> مالک ملک هستم
          </Label>
          <Label className="border-border flex min-h-12 items-center gap-3 rounded-lg border px-4">
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
          ساخت پیش‌نویس و ادامه
        </Button>
      </CardContent>
    </Card>
  );
}

function LocationFields({
  submission,
  validation,
}: {
  submission: Submission;
  validation?: ValidationState;
}) {
  const [query, setQuery] = useState(submission.location?.neighborhood ?? "");
  const [selectedId, setSelectedId] = useState(
    submission.location?.neighborhood_id ?? "",
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
          نام محله را بنویسید و یک نتیجه بازبینی‌شده را انتخاب کنید.
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
          defaultValue={facts?.property_type ?? "apartment"}
          aria-invalid={Boolean(typeError)}
          aria-describedby={typeError ? "property-type-error" : undefined}
        >
          <option value="apartment">آپارتمان</option>
          <option value="house">خانه</option>
          <option value="villa">ویلا</option>
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
        <span>تعداد اتاق خواب</span>
        <Input
          name="room_count"
          aria-label="تعداد اتاق خواب"
          inputMode="numeric"
          defaultValue={facts?.room_count}
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
      <Label className="space-y-2">
        <span>شماره تماس</span>
        <Input
          name="phone"
          aria-label="شماره تماس"
          inputMode="tel"
          defaultValue={submission.contact?.phone}
          aria-invalid={Boolean(phoneError)}
          aria-describedby={phoneError ? "contact-phone-error" : undefined}
        />
        <FieldError id="contact-phone-error" message={phoneError} />
      </Label>
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
        اختیار ثبت اطلاعات این ملک را دارم.
        <FieldError id="authorization-error" message={authorizationError} />
      </Label>
      <Label className="flex min-h-11 items-start gap-3">
        <input
          name="phone_publication_consent"
          type="checkbox"
          defaultChecked={submission.contact?.phone_publication_consent}
          aria-invalid={Boolean(consentError)}
          aria-describedby={consentError ? "consent-error" : undefined}
        />
        با نمایش عمومی شماره تماس موافقم.
        <FieldError id="consent-error" message={consentError} />
      </Label>
    </div>
  );
}

function StepFields({
  step,
  submission,
  validation,
}: {
  step: StepId;
  submission: Submission;
  validation?: ValidationState;
}) {
  if (step === "location") {
    return <LocationFields submission={submission} validation={validation} />;
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
    return (
      <Alert>
        <ImagePlus aria-hidden="true" />
        <AlertTitle>افزودن تصویر در مرحله بعدی محصول فعال می‌شود</AlertTitle>
        <AlertDescription>
          اکنون می‌توانید اطلاعات تماس و بازبینی را ذخیره کنید، اما Submission
          بدون تصاویر وارد صف بررسی اپراتور نمی‌شود.
        </AlertDescription>
      </Alert>
    );
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
      </dl>
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
          پیش‌نویس ذخیره می‌شود؛ ارسال برای بررسی تا تکمیل تصاویر غیرفعال است.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function stepPayload(
  step: StepId,
  form: FormData,
): SubmissionStepUpdate | null {
  if (step === "images") return null;
  if (step === "location") {
    return {
      completed_step: step,
      location: {
        neighborhood_id: formValue(form, "neighborhood_id"),
        address: formValue(form, "address"),
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
        property_type: formValue(form, "property_type") as "apartment",
        area_sqm: numericValue(form, "area_sqm"),
        room_count: numericValue(form, "room_count"),
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
    mutationFn: (body: SubmissionStepUpdate) =>
      saveSubmissionStep(submissionId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(["submissions", submissionId], saved);
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

  const goNextWithoutSave = () => {
    if (stepIndex < steps.length - 1) {
      setSearchParams({
        submission: submissionId,
        step: steps[stepIndex + 1]!.id,
      });
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
            "location.neighborhood_id": "یک محله بازبینی‌شده انتخاب کنید.",
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
        deposit > 900_719_925_474_099 ||
        rent > 900_719_925_474_099 ||
        (deposit === 0 && rent === 0)
      ) {
        const message =
          deposit === 0 && rent === 0
            ? "ودیعه و اجاره ماهانه نمی‌توانند هم‌زمان صفر باشند."
            : "مبلغ واردشده بیش از حد مجاز است.";
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
        !form.has("authorization_declared"))
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
        },
      });
      return;
    }
    if (step === "review" && !form.has("accuracy_confirmed")) {
      const message = "تأیید درستی اطلاعات الزامی است.";
      setValidation({
        message,
        fields: { "review.accuracy_confirmed": message },
      });
      return;
    }
    if (payload) mutation.mutate(payload);
  };

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary" className="mb-3">
            <Save aria-hidden="true" /> پیش‌نویس ذخیره شده
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            ثبت آگهی اجاره
          </h1>
          <p className="text-muted-foreground mt-2">
            مرحله {persianStepNumbers[stepIndex]} از ۷ · {stepMeta.label}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/dashboard">ذخیره و خروج</Link>
        </Button>
      </header>
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,42rem)]">
        <nav aria-label="مراحل ثبت آگهی">
          <ol className="space-y-2">
            {steps.map((item, index) => (
              <li key={item.id}>
                <Link
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                    index === stepIndex
                      ? "bg-primary/10 text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                  to={`?submission=${submissionId}&step=${item.id}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                >
                  {index < stepIndex ? (
                    <Check className="size-5" />
                  ) : (
                    <Circle className="size-5" />
                  )}
                  {item.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-tight">
              {stepMeta.label}
            </h2>
            <p className="text-muted-foreground text-sm">
              هر مرحله پس از ادامه روی سرور ذخیره می‌شود.
            </p>
          </CardHeader>
          <CardContent>
            {validation && (
              <Alert className="mb-6" variant="destructive" role="alert">
                <AlertTitle>اطلاعات این مرحله را بررسی کنید</AlertTitle>
                <AlertDescription>{validation.message}</AlertDescription>
              </Alert>
            )}
            <form className="space-y-7" onSubmit={submit}>
              <StepFields
                step={step}
                submission={submission}
                validation={validation}
              />
              <div className="flex flex-wrap justify-between gap-3 border-t pt-6">
                {stepIndex > 0 ? (
                  <Button asChild variant="outline">
                    <Link
                      to={`?submission=${submissionId}&step=${steps[stepIndex - 1]!.id}`}
                    >
                      مرحله قبل
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                {step === "images" ? (
                  <Button type="button" onClick={goNextWithoutSave}>
                    ادامه به اطلاعات تماس
                  </Button>
                ) : (
                  <Button disabled={mutation.isPending} type="submit">
                    {step === "review" ? "ذخیره بازبینی" : "ذخیره و ادامه"}
                  </Button>
                )}
              </div>
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
    <PageMain>
      {submissionId ? (
        <DraftFlow submissionId={submissionId} />
      ) : (
        <>
          <header className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight">
              ثبت آگهی اجاره
            </h1>
            <p className="text-muted-foreground mt-2">
              یک پیش‌نویس قابل ادامه بسازید.
            </p>
          </header>
          <RoleChooser
            onCreated={(draft) =>
              setSearchParams({ submission: draft.id, step: "location" })
            }
          />
        </>
      )}
    </PageMain>
  );
}

export default AddSubmissionPage;
