import { ChevronDown, CircleHelp, Star } from "lucide-react";
import {
  fitBandLabels,
  preferenceLabels,
  type PreferenceAssessment,
} from "./preferences";

export function PreferenceFit({
  assessment,
}: {
  assessment: PreferenceAssessment;
}) {
  return (
    <details className="group/fit relative z-10 my-2 rounded-xl bg-amber-50/60 p-2 text-sm dark:bg-amber-950/20">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-2 [&::-webkit-details-marker]:hidden"
        aria-label={
          assessment.band
            ? `${fitBandLabels[assessment.band]} با ترجیحات شما`
            : "اطلاعات کافی برای سنجش تناسب نیست"
        }
      >
        <span className="flex items-center gap-1" aria-hidden="true">
          {assessment.band ? (
            [1, 2, 3].map((star) => (
              <Star
                key={star}
                className={`size-5 ${star <= { high: 3, reasonable: 2, weak: 1 }[assessment.band!] ? "fill-amber-500 text-amber-600 dark:text-amber-400" : "text-amber-300/70 dark:text-amber-800"}`}
              />
            ))
          ) : (
            <CircleHelp className="text-muted-foreground size-5" />
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform group-open/fit:rotate-180"
        />
      </summary>
      <p className="text-muted-foreground px-2 pt-2 pb-1 text-xs">
        ستاره‌ها میزان تناسب با ترجیحات شما را نشان می‌دهند.
      </p>
      {(
        [
          ["satisfied", "هم‌راستا با خواسته شما"],
          ["trade_offs", "فاصله از خواسته شما، به ترتیب اهمیت"],
          ["unknown", "اطلاعات نامشخص"],
        ] as const
      ).map(
        ([field, label]) =>
          assessment[field].length > 0 && (
            <p key={field} className="mt-2 leading-6">
              {label}:{" "}
              {assessment[field].map((id) => preferenceLabels[id]).join("، ")}
            </p>
          ),
      )}
    </details>
  );
}
