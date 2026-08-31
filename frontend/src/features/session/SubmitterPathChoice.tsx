import { Building2, Globe2 } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SubmitterOnboardingPath = "submission" | "source_proposal";

const choices = [
  {
    path: "submission",
    title: "ثبت یک ملک",
    description:
      "رابطه مالک یا نماینده را برای این Submission مشخص می‌کنید و اطلاعات ملک را در هفت مرحله ادامه می‌دهید؛ Direct Listing تنها پس از بررسی اپراتور منتشر می‌شود.",
    icon: Building2,
  },
  {
    path: "source_proposal",
    title: "معرفی وب‌سایت اجاره",
    description:
      "یک منبع بیرونی را برای اعتبارسنجی معرفی می‌کنید؛ این انتخاب هیچ ملکی را خودکار منتشر نمی‌کند.",
    icon: Globe2,
  },
] as const;

export function SubmitterPathChoice({
  selectedPath,
  pending,
  onSelect,
}: {
  selectedPath: SubmitterOnboardingPath | null;
  pending: boolean;
  onSelect: (path: SubmitterOnboardingPath) => void;
}) {
  return (
    <>
      <header className="max-w-2xl">
        <p className="text-primary text-sm font-semibold">مسیر ارسال‌کننده</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          چه چیزی می‌خواهید معرفی کنید؟
        </h1>
        <p className="text-muted-foreground mt-4 leading-8">
          انتخاب شما ذخیره می‌شود تا پس از وقفه یا ورود دوباره از همین‌جا ادامه
          دهید. این انتخاب به‌تنهایی هیچ موردی ایجاد یا منتشر نمی‌کند.
        </p>
      </header>
      <div
        className="mt-8 grid gap-4 md:grid-cols-2"
        role="group"
        aria-label="انتخاب مسیر"
      >
        {choices.map((choice) => {
          const Icon = choice.icon;
          const selected = selectedPath === choice.path;
          return (
            <button
              key={choice.path}
              type="button"
              aria-pressed={selected}
              className="focus-visible:ring-ring rounded-xl text-start focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              disabled={pending}
              onClick={() => onSelect(choice.path)}
            >
              <Card
                className={cn(
                  "hover:border-primary/70 h-full shadow-none transition-colors",
                  selected && "border-primary bg-primary/5",
                )}
              >
                <CardHeader className="flex-row items-center gap-3">
                  <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
                    <Icon aria-hidden="true" />
                  </span>
                  <h2 className="text-xl font-semibold">{choice.title}</h2>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-7">
                    {choice.description}
                  </p>
                  {selected ? (
                    <p
                      className="text-primary mt-4 font-semibold"
                      role="status"
                    >
                      این مسیر برای ادامه ذخیره شده است.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </>
  );
}
