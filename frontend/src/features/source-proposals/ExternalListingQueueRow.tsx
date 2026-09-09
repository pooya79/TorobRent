import { ArrowLeft, Building2, ShieldCheck, UserRound } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { propertyTypeLabels } from "@/features/catalog/property-taxonomy";
import type {
  ExternalListingCandidate,
  OperatorSourceProposal,
} from "./queries";
import {
  candidateNeedsAttention,
  candidateStatus,
  rentalAmount,
  representativeName,
} from "./external-listing-workflow";

export function ExternalListingQueueRow({
  candidate,
  proposal,
  mine,
  onOpen,
}: {
  candidate: ExternalListingCandidate;
  proposal?: OperatorSourceProposal;
  mine: boolean;
  onOpen: () => void;
}) {
  const images = candidate.media.filter(
    (image) => image.state === "ready" && !image.excluded,
  );
  const image = images.find((image) => image.is_primary) ?? images[0];
  const thumbnail = image?.variants.find(
    (variant) => variant.kind === "small",
  )?.url;
  return (
    <article
      aria-label={candidate.title || "آگهی بدون عنوان"}
      className="hover:bg-muted/20 grid items-center gap-4 border-t p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)]"
    >
      <div className="flex min-w-0 items-center gap-4 sm:col-span-2 xl:col-span-1">
        <div className="bg-muted text-muted-foreground flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="size-7" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <h2 className="leading-7 font-semibold">
            <button
              type="button"
              onClick={onOpen}
              className="hover:text-primary focus-visible:outline-ring rounded text-start focus-visible:outline-2"
            >
              {candidate.title || "آگهی بدون عنوان"}
            </button>
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {candidate.property_type
              ? propertyTypeLabels[candidate.property_type]
              : "نوع ملک نامشخص"}{" "}
            ·{" "}
            {candidate.area_sqm == null
              ? "متراژ نامشخص"
              : `${candidate.area_sqm.toLocaleString("fa-IR")} متر مربع`}
            {candidate.room_count != null &&
              ` · ${candidate.room_count.toLocaleString("fa-IR")} اتاق`}
          </p>
          <time
            dateTime={candidate.created_at}
            className="text-muted-foreground mt-1 block text-xs"
          >
            دریافت {new Date(candidate.created_at).toLocaleDateString("fa-IR")}
          </time>
        </div>
      </div>
      <div className="min-w-0 space-y-2 text-sm">
        <Link
          to={`/operator/source-proposals/${candidate.source_proposal_id}`}
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          {candidate.source.display_name}
        </Link>
        <bdi className="text-muted-foreground block w-fit max-w-full truncate text-xs">
          {candidate.source.domain}
        </bdi>
        <p className="flex items-start gap-2">
          <UserRound
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            <span className="text-muted-foreground">نماینده: </span>
            <bdi>{representativeName(proposal)}</bdi>
          </span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-1">
        <div>
          <dt className="text-muted-foreground text-xs">رهن</dt>
          <dd className="mt-1 font-medium">
            {rentalAmount(candidate.deposit_rial)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">اجاره ماهانه</dt>
          <dd className="mt-1 font-medium">
            {rentalAmount(candidate.monthly_rent_rial)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 xl:block xl:space-y-2">
        <div className="space-y-2">
          <Badge
            variant={
              candidateNeedsAttention(candidate) ? "destructive" : "secondary"
            }
          >
            {candidateStatus(candidate)}
          </Badge>
          <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-all">
              <span className="sr-only">اپراتور مسئول: </span>
              <bdi>
                {mine
                  ? "واگذارشده به من"
                  : proposal?.responsibility?.operator_label ||
                    (proposal?.assignment?.review_operator
                      ? "اپراتور دیگر"
                      : "مسئول تعیین نشده")}
              </bdi>
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpen}
          aria-label={`مشاهده و بررسی ${candidate.title}`}
        >
          مشاهده و بررسی <ArrowLeft aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
