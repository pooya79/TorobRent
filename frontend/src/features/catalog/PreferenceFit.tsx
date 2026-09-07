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
    <details className="relative z-10 my-2 rounded-md border p-2 text-sm">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">
        {assessment.band
          ? `${fitBandLabels[assessment.band]} با ترجیحات شما`
          : "اطلاعات کافی برای سنجش تناسب نیست"}
      </summary>
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
