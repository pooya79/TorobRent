import type { ExternalListingCandidate } from "./queries";

import { CandidateMedia } from "./CandidateMedia";

const labels: Record<string, string> = {
  city: "شهر",
  district: "منطقه",
  neighborhood: "محله",
  property_type: "نوع ملک",
  floor_area_sqm: "متراژ",
  area_sqm: "متراژ",
  bedroom_count: "اتاق خواب",
  room_count: "اتاق خواب",
  deposit_rial: "ودیعه",
  monthly_rent_rial: "اجاره ماهانه",
  title: "عنوان",
  description: "توضیحات",
  structure: "ساختار صفحه",
};

export function CandidateEvidence({
  candidate,
  showValidation = true,
}: {
  showValidation?: boolean;
  candidate: ExternalListingCandidate;
}) {
  return (
    <details className="text-sm">
      <summary>شواهد و اعتبارسنجی</summary>
      <CandidateMedia images={candidate.media} />
      <dl className="grid gap-2 p-2">
        {showValidation &&
          Object.entries(candidate.validation_errors ?? {}).map(
            ([field, messages]) => (
              <div key={field}>
                <dt className="font-semibold">{labels[field] ?? field}</dt>
                <dd>
                  {Array.isArray(messages)
                    ? messages.join(" · ")
                    : String(messages)}
                </dd>
              </div>
            ),
          )}
      </dl>
      {Object.entries(candidate.evidence ?? {}).map(([field, evidence]) => (
        <section key={field} className="border-t p-2">
          <h6 className="font-semibold">{labels[field] ?? field}</h6>
          {Array.isArray(evidence) &&
            evidence.map(
              (
                item: { evidence_snippet?: string; disposition?: string },
                index,
              ) => (
                <p key={index}>
                  {item.disposition === "conflicting_candidate"
                    ? "شاهد متعارض: "
                    : ""}
                  {item.evidence_snippet}
                </p>
              ),
            )}
        </section>
      ))}
    </details>
  );
}
