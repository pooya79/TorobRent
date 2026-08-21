import { Check, Circle, Save } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const steps = [
  "نقش شما",
  "نشانی ملک",
  "مشخصات ملک",
  "شرایط اجاره",
  "امکانات",
  "تصاویر",
  "بازبینی و ارسال",
] as const;

const featureStates = [
  { value: "present", label: "دارد" },
  { value: "absent", label: "ندارد" },
  { value: "unknown", label: "نمی‌دانم" },
] as const;

const persianStepNumbers = ["۱", "۲", "۳", "۴", "۵", "۶", "۷"] as const;

function FeatureStateFields({ feature = "آسانسور" }: { feature?: string }) {
  const fieldName = feature === "آسانسور" ? "elevator" : "parking";
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">وضعیت {feature}</legend>
      <RadioGroup className="grid gap-3 sm:grid-cols-3" defaultValue="present">
        {featureStates.map(({ value, label }) => (
          <Label
            className="border-border has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4"
            htmlFor={`${fieldName}-${value}`}
            key={value}
          >
            <RadioGroupItem id={`${fieldName}-${value}`} value={value} />
            {label}
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function StepFields({
  currentStep,
  showValidation,
}: {
  currentStep: number;
  showValidation: boolean;
}) {
  if (currentStep === 1) {
    return (
      <RadioGroup defaultValue="owner" className="grid gap-3 sm:grid-cols-2">
        <Label className="border-border flex min-h-12 items-center gap-3 rounded-lg border px-4">
          <RadioGroupItem value="owner" /> مالک ملک هستم
        </Label>
        <Label className="border-border flex min-h-12 items-center gap-3 rounded-lg border px-4">
          <RadioGroupItem value="agent" /> نماینده مالک هستم
        </Label>
      </RadioGroup>
    );
  }
  if (currentStep === 2) {
    return (
      <div className="grid gap-5">
        <Label className="space-y-2">
          <span>محله</span>
          <Input defaultValue="سعادت‌آباد" />
        </Label>
        <Label className="space-y-2">
          <span>نشانی</span>
          <Input defaultValue="بلوار دریا، کوچه سرو" />
        </Label>
      </div>
    );
  }
  if (currentStep === 3) {
    return (
      <>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="area">متراژ</Label>
            <Input
              id="area"
              inputMode="numeric"
              defaultValue={showValidation ? "۰" : "۱۱۰"}
              aria-invalid={showValidation}
              aria-describedby={showValidation ? "area-error" : undefined}
            />
            {showValidation && (
              <p id="area-error" className="text-destructive text-xs">
                متراژ باید بیشتر از صفر باشد.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rooms">تعداد اتاق خواب</Label>
            <Input id="rooms" inputMode="numeric" defaultValue="۲" />
          </div>
        </div>
        <FeatureStateFields />
      </>
    );
  }
  if (currentStep === 4) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <Label className="space-y-2">
          <span>ودیعه، تومان</span>
          <Input inputMode="numeric" defaultValue="۱۰۰۰۰۰۰۰۰۰" />
        </Label>
        <Label className="space-y-2">
          <span>اجاره ماهانه، تومان</span>
          <Input inputMode="numeric" defaultValue="۲۵۰۰۰۰۰" />
        </Label>
      </div>
    );
  }
  if (currentStep === 5) return <FeatureStateFields feature="پارکینگ" />;
  if (currentStep === 6) {
    return (
      <Label className="border-border flex min-h-32 cursor-pointer items-center justify-center rounded-xl border border-dashed p-6 text-center">
        <span>انتخاب تصاویر مجاز ملک</span>
        <Input className="sr-only" type="file" multiple />
      </Label>
    );
  }
  return (
    <dl className="bg-muted grid gap-4 rounded-xl p-5 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">نشانی</dt>
        <dd>تهران، سعادت‌آباد</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">شرایط اجاره</dt>
        <dd>۱ میلیارد ودیعه · ۲۵ میلیون اجاره</dd>
      </div>
    </dl>
  );
}

export function AddSubmissionPage() {
  const [searchParams] = useSearchParams();
  const showValidation = searchParams.get("prototypeState") === "validation";
  const requestedStep = Number(searchParams.get("step") ?? "3");
  const currentStep = Math.min(7, Math.max(1, requestedStep || 3));
  const stepHref = (step: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("step", String(step));
    return `/add-submission?${next.toString()}`;
  };

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-360 px-4 py-8 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="secondary" className="mb-3">
            <Save aria-hidden="true" /> پیش‌نویس ذخیره شده
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            ثبت آگهی اجاره
          </h1>
          <p className="text-muted-foreground mt-2">
            مرحله {persianStepNumbers[currentStep - 1]} از ۷ ·{" "}
            {steps[currentStep - 1]}
          </p>
        </div>
        <Button variant="outline">ذخیره و خروج</Button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,42rem)]">
        <nav aria-label="مراحل ثبت آگهی">
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const number = index + 1;
              const complete = number < currentStep;
              const current = number === currentStep;
              return (
                <li key={step}>
                  <Link
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                      current
                        ? "bg-primary/10 text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    to={stepHref(number)}
                    aria-current={current ? "step" : undefined}
                  >
                    {complete ? (
                      <Check
                        className="text-primary size-5"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle className="size-5" aria-hidden="true" />
                    )}
                    {step}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="shadow-none">
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-tight">
              {steps[currentStep - 1]}
            </h2>
            <p className="text-muted-foreground text-sm">
              پیش‌نویس هر مرحله ذخیره می‌شود و بعداً قابل ادامه است.
            </p>
          </CardHeader>
          <CardContent>
            {showValidation && currentStep === 3 && (
              <Alert className="mb-6" variant="destructive">
                <AlertTitle>متراژ را بررسی کنید</AlertTitle>
                <AlertDescription>
                  یک مورد مانع رفتن به مرحله بعد است. فیلد مشخص‌شده را اصلاح
                  کنید.
                </AlertDescription>
              </Alert>
            )}
            <form className="space-y-7">
              <StepFields
                currentStep={currentStep}
                showValidation={showValidation}
              />
              <div className="flex flex-wrap justify-between gap-3 border-t pt-6">
                {currentStep > 1 ? (
                  <Button asChild variant="outline">
                    <Link to={stepHref(currentStep - 1)}>مرحله قبل</Link>
                  </Button>
                ) : (
                  <span />
                )}
                {currentStep < 7 ? (
                  <Button asChild className="rounded-full">
                    <Link to={stepHref(currentStep + 1)}>
                      ادامه به {steps[currentStep]}
                    </Link>
                  </Button>
                ) : (
                  <Button className="rounded-full" type="button">
                    ارسال برای بررسی
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default AddSubmissionPage;
