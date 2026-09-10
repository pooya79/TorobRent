import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { locationAutocompleteQueryOptions } from "@/features/catalog/queries";
import { propertyTypeOptions } from "@/features/catalog/property-taxonomy";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import {
  type ExternalListingCandidate,
  operatorExternalListingCandidatesQueryOptions,
  operatorSourceProposalsQueryOptions,
} from "./queries";

import { CandidateMedia, type MediaChoice } from "./CandidateMedia";

const numericFields = {
  area_sqm: "متراژ (متر مربع)",
  room_count: "تعداد اتاق خواب",
  deposit_rial: "رهن (تومان)",
  monthly_rent_rial: "اجاره ماهانه (تومان)",
} as const;

export function CandidateCorrectionForm({
  candidate,
  onCorrected,
  onDirtyChange,
}: {
  candidate: ExternalListingCandidate;
  onCorrected?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [values, setValues] = useState<
    components["schemas"]["CandidateCorrectionValues"]
  >({});
  const [media, setMedia] = useState<MediaChoice[]>(
    candidate.media.map((image) => ({
      id: image.id,
      excluded: !!image.excluded,
      is_primary: !!image.is_primary,
      accept_as_property: !!image.accepted_at,
    })),
  );
  const [mediaChanged, setMediaChanged] = useState(false);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(false);
  const locations = useQuery(locationAutocompleteQueryOptions(query));
  const queryClient = useQueryClient();
  const correction = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/external-listing-candidates/{candidate_id}/correct/",
        {
          params: { path: { candidate_id: candidate.id } },
          body: {
            reviewed_revision: candidate.revision,
            reason,
            values,
            ...(mediaChanged ? { media } : {}),
          },
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData<ExternalListingCandidate[]>(
        operatorExternalListingCandidatesQueryOptions.queryKey,
        (current) =>
          current?.map((item) => (item.id === data.id ? data : item)),
      );
      void queryClient.invalidateQueries({
        queryKey: operatorSourceProposalsQueryOptions.queryKey,
      });
      onDirtyChange?.(false);
      onCorrected?.();
      setValues({});
      setMediaChanged(false);
    },
  });
  return (
    <form
      className="mt-4 grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        correction.mutate();
      }}
    >
      <p className="text-muted-foreground text-sm sm:col-span-2">
        این تغییر فقط برای همین ملک ذخیره می‌شود و روی ملک‌های دیگر اثر ندارد.
      </p>
      <div className="grid content-start gap-2">
        <Label htmlFor={`location-${candidate.id}`}>محله بازبینی‌شده</Label>
        <Input
          id={`location-${candidate.id}`}
          value={query}
          onChange={(event) => {
            onDirtyChange?.(true);
            setQuery(event.target.value);
            setSelected(false);
            setValues((current) => {
              const next = { ...current };
              delete next.neighborhood;
              return next;
            });
          }}
        />
        {!selected &&
          locations.data
            ?.filter((item) => item.kind === "neighborhood")
            .map((item) => (
              <Button
                type="button"
                variant="outline"
                key={item.id}
                onClick={() => {
                  onDirtyChange?.(true);
                  setValues((current) => ({
                    ...current,
                    neighborhood: item.id,
                  }));
                  setQuery(item.label);
                  setSelected(true);
                }}
              >
                {item.label}
              </Button>
            ))}
        {locations.isError && <p role="alert">محله‌ها بارگذاری نشد.</p>}
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`type-${candidate.id}`}>نوع ملک</Label>
        <select
          id={`type-${candidate.id}`}
          className="rounded border p-2"
          value={values.property_type ?? candidate.property_type}
          onChange={(event) => {
            onDirtyChange?.(true);
            setValues((current) => ({
              ...current,
              property_type: event.target
                .value as components["schemas"]["PropertyTypeEnum"],
            }));
          }}
        >
          <option value="">نامشخص</option>
          {propertyTypeOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {Object.entries(numericFields).map(([key, label]) => {
        const field = key as keyof typeof numericFields;
        const factor = field.endsWith("_rial") ? 10 : 1;
        const value = field in values ? values[field] : candidate[field];
        return (
          <div key={field}>
            <Label htmlFor={`${field}-${candidate.id}`}>{label}</Label>
            <Input
              id={`${field}-${candidate.id}`}
              type="number"
              min={0}
              value={value == null ? "" : value / factor}
              onChange={(event) => {
                onDirtyChange?.(true);
                setValues((current) => ({
                  ...current,
                  [field]:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value) * factor,
                }));
              }}
            />
          </div>
        );
      })}
      <div className="grid gap-2 sm:col-span-2">
        <CandidateMedia
          images={candidate.media}
          choices={media}
          onChange={(next) => {
            onDirtyChange?.(true);
            setMedia(next);
            setMediaChanged(true);
          }}
        />
        <Label htmlFor={`correction-reason-${candidate.id}`}>دلیل اصلاح</Label>
        <Input
          id={`correction-reason-${candidate.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={
          !reason.trim() ||
          (Object.keys(values).length === 0 && !mediaChanged) ||
          correction.isPending
        }
      >
        ذخیره اصلاح آگهی
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={correction.isPending}
        onClick={() => {
          setValues({});
          setMedia(
            candidate.media.map((image) => ({
              id: image.id,
              excluded: !!image.excluded,
              is_primary: !!image.is_primary,
              accept_as_property: !!image.accepted_at,
            })),
          );
          setMediaChanged(false);
          setQuery("");
          setSelected(false);
          setReason("");
          onDirtyChange?.(false);
        }}
      >
        انصراف از اصلاحات ذخیره‌نشده
      </Button>
      {correction.isError && (
        <p role="alert" className="sm:col-span-2">
          {correction.error.message}
        </p>
      )}
      {correction.isSuccess && (
        <p role="status" className="sm:col-span-2">
          اصلاح ذخیره شد؛ اعتبارسنجی دوباره انجام شد.
        </p>
      )}
    </form>
  );
}
