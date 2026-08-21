import { Check, Circle, Save } from "lucide-react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AddSubmissionPage() {
  const [searchParams] = useSearchParams();
  const showValidation = searchParams.get("prototypeState") === "validation";

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
            مرحله ۳ از ۷ · مشخصات ملک
          </p>
        </div>
        <Button variant="outline">ذخیره و خروج</Button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,42rem)]">
        <nav aria-label="مراحل ثبت آگهی">
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const number = index + 1;
              const complete = number < 3;
              const current = number === 3;
              return (
                <li
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                    current
                      ? "bg-primary/10 text-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                  key={step}
                  aria-current={current ? "step" : undefined}
                >
                  {complete ? (
                    <Check className="text-primary size-5" aria-hidden="true" />
                  ) : (
                    <Circle className="size-5" aria-hidden="true" />
                  )}
                  {step}
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-xl">مشخصات پایه ملک</CardTitle>
            <p className="text-muted-foreground text-sm">
              اطلاعاتی را وارد کنید که درباره آن مطمئن هستید.
            </p>
          </CardHeader>
          <CardContent>
            {showValidation && (
              <Alert className="mb-6" variant="destructive">
                <AlertTitle>متراژ را بررسی کنید</AlertTitle>
                <AlertDescription>
                  یک مورد مانع رفتن به مرحله بعد است. فیلد مشخص‌شده را اصلاح
                  کنید.
                </AlertDescription>
              </Alert>
            )}
            <form className="space-y-7">
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
              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  وضعیت آسانسور
                </legend>
                <RadioGroup
                  className="grid gap-3 sm:grid-cols-3"
                  defaultValue="present"
                >
                  {featureStates.map(({ value, label }) => (
                    <Label
                      className="border-border has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4"
                      htmlFor={`elevator-${value}`}
                      key={value}
                    >
                      <RadioGroupItem id={`elevator-${value}`} value={value} />
                      {label}
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
              <div className="flex flex-wrap justify-between gap-3 border-t pt-6">
                <Button variant="outline" type="button">
                  مرحله قبل
                </Button>
                <Button className="rounded-full" type="button">
                  ادامه به شرایط اجاره
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default AddSubmissionPage;
