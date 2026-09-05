import type { OperatorSourceProposal } from "./queries";
import { classificationLabels, discoveryStageLabels } from "./discovery-labels";

export function DiscoveryEvidence({
  proposal,
}: {
  proposal: OperatorSourceProposal;
}) {
  const discovery = proposal.discovery;
  const evidence = discovery?.evidence;
  return (
    <section
      aria-label="نتیجه کشف صفحات"
      className="grid gap-4 rounded-lg border p-4"
    >
      <h3 className="font-semibold">
        {discoveryStageLabels[proposal.discovery_stage ?? "awaiting_url"]}
      </h3>
      {discovery && (
        <p>
          پایان رزرو دامنه:{" "}
          {new Date(discovery.expires_at).toLocaleString("fa-IR")}
        </p>
      )}
      {evidence && (
        <>
          <p>
            صفحات بررسی‌شده: {evidence.page_count?.toLocaleString("fa-IR")}؛
            آگهی اجاره: {evidence.detail_page_count?.toLocaleString("fa-IR")}
          </p>
          <ul>
            {Object.entries(evidence.classifications ?? {}).map(
              ([kind, count]) => (
                <li key={kind}>
                  {classificationLabels[kind] ?? kind}:{" "}
                  {count.toLocaleString("fa-IR")}
                </li>
              ),
            )}
          </ul>
          {evidence.structures?.map((structure) => (
            <div key={structure.fingerprint} className="rounded border p-3">
              <p>
                {structure.selected ? "ساختار غالب" : "ساختار دیگر"}؛ پوشش:{" "}
                {(structure.coverage * 100).toLocaleString("fa-IR")}%
              </p>
              <p dir="ltr" className="break-all">
                {structure.representative_url_shape}
              </p>
              <p>
                صفحات پشتیبانی‌شده:{" "}
                {structure.supported_page_urls.length.toLocaleString("fa-IR")}
              </p>
            </div>
          ))}
          {!!evidence.exclusions?.length && (
            <div>
              <h4>صفحات خارج از پوشش</h4>
              <ul>
                {evidence.exclusions.map((url) => (
                  <li dir="ltr" className="break-all" key={url}>
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!evidence.samples?.length && (
            <div>
              <h4>نمونه‌های نماینده</h4>
              <ul className="grid gap-3">
                {evidence.samples.map((sample) => (
                  <li key={sample.url}>
                    <p dir="ltr" className="break-all">
                      {sample.url}
                    </p>
                    <p>
                      {classificationLabels[sample.classification] ??
                        sample.classification}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {sample.evidence.join("؛ ")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!evidence.failures?.length && (
            <div>
              <h4>خطاهای کشف</h4>
              <ul>
                {evidence.failures.map((failure, index) => (
                  <li key={`${failure.url}-${index}`}>
                    <p dir="ltr" className="break-all">
                      {failure.url}
                    </p>
                    <p>{failure.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
