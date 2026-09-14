import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { isCatalogCurationListQuery } from "./queries";

type Comparison = components["schemas"]["PropertyComparison"];

const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function operatorFacingText(value: string) {
  if (/^Extraction Run\s+/i.test(value) && uuidPattern.test(value)) {
    uuidPattern.lastIndex = 0;
    return "اجرای استخراج";
  }
  uuidPattern.lastIndex = 0;
  return value.replace(uuidPattern, "شناسه داخلی");
}

function factLabel(value: unknown): string {
  if (value == null || value === "") return "نامشخص";
  if (typeof value === "string") return operatorFacingText(value);
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  return JSON.stringify(value);
}

export function PropertyMatchReview({
  comparison,
  suggestionId,
  onRefresh,
  guided = false,
}: {
  comparison: Comparison;
  suggestionId?: string;
  onRefresh: () => void;
  guided?: boolean;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [showAllFacts, setShowAllFacts] = useState(false);
  const [survivor, setSurvivor] = useState(comparison.suggested_survivor_id);
  const [survivorConfirmed, setSurvivorConfirmed] = useState(false);
  const [facts, setFacts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      comparison.decision_fields.map((field) => [
        field.key,
        field.conflicting ? "" : comparison.suggested_survivor_id,
      ]),
    ),
  );
  const [images, setImages] = useState<string[]>([]);
  const [imagesConfirmed, setImagesConfirmed] = useState(false);
  const [warningConfirmed, setWarningConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [snoozeDays, setSnoozeDays] = useState<1 | 7 | 30>(7);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(
    comparison.claim?.expires_at ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{
    outcome: "same_property" | "not_same_property" | "snoozed";
    survivorId?: string;
  } | null>(null);
  const properties = comparison.properties.map((property) => property.id);
  const warning =
    comparison.band === "below_threshold" ||
    comparison.signals.some((signal) => signal.classification === "blocker");
  const refreshCurrentRootsOnConflict = (status: number) => {
    if (status === 409) onRefresh();
  };
  const claim = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST(
        "/api/v1/operator/catalog-curation/claim/",
        {
          body: {
            properties,
            revision: comparison.revision,
            suggestion_id: suggestionId,
          },
        },
      );
      if (error || !data?.claim) {
        refreshCurrentRootsOnConflict(response.status);
        throw new Error(
          error
            ? operatorFacingText(apiError(error).message)
            : "بررسی در اختیار شما نیست یا شواهد تغییر کرده است. مقایسه را تازه کنید.",
        );
      }
      return data.claim;
    },
    onSuccess: (data) => {
      setClaimId(data.id);
      setExpiresAt(data.expires_at);
      setMessage(null);
    },
    onError: (error) => {
      setClaimId(null);
      setMessage(error.message);
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (!claimId) throw new Error("ابتدا بررسی را شروع کنید.");
      const { data, error, response } = await api.POST(
        "/api/v1/operator/catalog-curation/approve/",
        {
          body: {
            properties,
            revision: comparison.revision,
            claim_id: claimId,
            survivor_id: survivor,
            survivor_confirmed: survivorConfirmed,
            fact_choices: facts,
            image_ids: images,
            images_confirmed: imagesConfirmed,
            warning_confirmed: warningConfirmed,
            reason,
            suggestion_id: suggestionId,
          },
        },
      );
      if (error || !data) {
        refreshCurrentRootsOnConflict(response.status);
        throw new Error(
          response.status === 409
            ? "شواهد یا مسئول بررسی تغییر کرده است. مقایسه را تازه کنید و دوباره تأیید کنید."
            : "گروه‌بندی انجام نشد. مجوز، مقادیر انتخاب‌شده و اعتبار بررسی را کنترل کنید.",
        );
      }
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      if (suggestionId) {
        void queryClient.invalidateQueries({
          predicate: (query) =>
            isCatalogCurationListQuery(query.queryKey, "suggestions"),
        });
      }
      setCompleted({
        outcome: "same_property",
        survivorId: data.survivor_id ?? undefined,
      });
      setClaimId(null);
      setMessage(null);
    },
    onError: (error) => {
      setMessage(error.message);
      setClaimId(null);
    },
  });
  const reject = useMutation({
    mutationFn: async () => {
      if (!claimId || !suggestionId)
        throw new Error("ابتدا بررسی را شروع کنید.");
      const { data, error, response } = await api.POST(
        "/api/v1/operator/catalog-curation/suggestions/{suggestion_id}/reject/",
        {
          params: { path: { suggestion_id: suggestionId } },
          body: { revision: comparison.revision, claim_id: claimId, reason },
        },
      );
      if (error || !data) {
        refreshCurrentRootsOnConflict(response.status);
        throw new Error(
          response.status === 409
            ? "شواهد یا مسئول بررسی تغییر کرده است. پیشنهاد را تازه کنید."
            : "تصمیم متفاوت بودن ثبت نشد.",
        );
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isCatalogCurationListQuery(query.queryKey, "suggestions"),
      });
      setCompleted({ outcome: "not_same_property" });
      setClaimId(null);
      setMessage(null);
    },
    onError: (error) => {
      setMessage(error.message);
      setClaimId(null);
    },
  });
  const snooze = useMutation({
    mutationFn: async () => {
      if (!claimId || !suggestionId)
        throw new Error("ابتدا بررسی را شروع کنید.");
      const { data, error, response } = await api.POST(
        "/api/v1/operator/catalog-curation/suggestions/{suggestion_id}/snooze/",
        {
          params: { path: { suggestion_id: suggestionId } },
          body: {
            revision: comparison.revision,
            claim_id: claimId,
            reason,
            days: snoozeDays,
          },
        },
      );
      if (error || !data) {
        refreshCurrentRootsOnConflict(response.status);
        throw new Error(
          response.status === 409
            ? "شواهد یا مسئول بررسی تغییر کرده است. پیشنهاد را تازه کنید."
            : "تعویق پیشنهاد ثبت نشد.",
        );
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isCatalogCurationListQuery(query.queryKey, "suggestions"),
      });
      setCompleted({ outcome: "snoozed" });
      setClaimId(null);
      setMessage(null);
    },
    onError: (error) => {
      setMessage(error.message);
      setClaimId(null);
    },
  });
  if (completed)
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p role="status">
            {completed.outcome === "same_property"
              ? "گروه‌بندی ثبت شد."
              : completed.outcome === "not_same_property"
                ? "تصمیم متفاوت بودن ثبت شد."
                : "پیشنهاد به تعویق افتاد."}
          </p>
          {completed.survivorId ? (
            <a
              className="text-primary underline"
              href={`/properties/${completed.survivorId}`}
            >
              مشاهده ملک باقی‌مانده
            </a>
          ) : null}
        </CardContent>
      </Card>
    );
  const busy =
    claim.isPending ||
    approve.isPending ||
    reject.isPending ||
    snooze.isPending;
  return (
    <Card className="gap-0 overflow-hidden shadow-none">
      <CardHeader
        className={
          guided ? "bg-muted/30 border-b py-4" : "bg-muted/30 border-b pb-6"
        }
      >
        <CardTitle>تصمیم تطبیق ملک</CardTitle>
      </CardHeader>
      <CardContent className={guided ? "space-y-4 pt-4" : "space-y-6 pt-6"}>
        <p>
          ملک کامل‌تر یا تازه‌تر بررسی‌شده پیشنهاد شده است. انتخاب نهایی با
          شماست.
        </p>
        {expiresAt && (
          <p>
            اعتبار بررسی تا {new Date(expiresAt).toLocaleTimeString("fa-IR")}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={busy} onClick={() => claim.mutate()}>
            {claimId ? "تمدید بررسی" : "شروع بررسی"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setClaimId(null);
              onRefresh();
            }}
          >
            تازه‌سازی مقایسه
          </Button>
        </div>
        {message && (
          <Alert variant="destructive">
            <AlertTitle>تصمیم ثبت نشد</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {!claimId ? (
          <p className="bg-muted/50 text-muted-foreground rounded-xl p-4 text-sm leading-7">
            ابتدا شواهد را بخوانید. با «شروع بررسی» امکان انتخاب مقادیر و ثبت
            تصمیم فعال می‌شود.
          </p>
        ) : null}
        {guided ? (
          <nav aria-label="مراحل ثبت تصمیم" className="grid grid-cols-3 gap-2">
            {["ملک اصلی", "مشخصات", "تصاویر و تأیید"].map((label, index) => (
              <Button
                key={label}
                variant={step === index ? "secondary" : "ghost"}
                disabled={busy}
                aria-current={step === index ? "step" : undefined}
                className="h-auto min-h-11 whitespace-normal"
                onClick={() => setStep(index)}
              >
                {(index + 1).toLocaleString("fa-IR")}. {label}
              </Button>
            ))}
          </nav>
        ) : null}
        <fieldset
          disabled={!claimId || busy}
          className="min-w-0 space-y-6 disabled:opacity-60"
        >
          <section
            className="space-y-4 rounded-xl border p-5"
            aria-labelledby="survivor-step"
            hidden={guided && step !== 0}
          >
            <h3 id="survivor-step" className="font-semibold">
              ۱. انتخاب ملک اصلی
            </h3>
            <p className="text-muted-foreground text-sm leading-7">
              آگهی‌ها در این ملک جمع می‌شوند. مشخصات نهایی را در مرحله بعد
              انتخاب کنید.
            </p>
            <label className="grid gap-2">
              ملک باقی‌مانده
              <select
                className="border-input bg-background min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
                value={survivor}
                onChange={(event) => {
                  setSurvivor(event.target.value);
                  setSurvivorConfirmed(false);
                }}
              >
                {properties.map((id, index) => (
                  <option value={id} key={id}>
                    ملک {(index + 1).toLocaleString("fa-IR")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={survivorConfirmed}
                onChange={(event) => setSurvivorConfirmed(event.target.checked)}
              />
              ملک باقی‌مانده را تأیید می‌کنم
            </label>
          </section>
          <section
            className="space-y-4 rounded-xl border p-5"
            aria-labelledby="facts-step"
            hidden={guided && step !== 1}
          >
            <h3 id="facts-step" className="font-semibold">
              ۲. مشخصات نهایی ملک
            </h3>
            <p className="text-muted-foreground text-sm leading-7">
              برای مشخصات متعارض، مقدار درست را از یکی از دو ملک انتخاب کنید.
            </p>
            {guided ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">
                  {comparison.decision_fields
                    .filter((field) => field.conflicting)
                    .length.toLocaleString("fa-IR")}{" "}
                  مشخصه متعارض؛ بقیه مقادیر از ملک پیشنهادی انتخاب شده‌اند.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAllFacts(!showAllFacts)}
                >
                  {showAllFacts ? "فقط مشخصات متعارض" : "نمایش همه مشخصات"}
                </Button>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              {comparison.decision_fields
                .filter((field) => !guided || showAllFacts || field.conflicting)
                .map((field) => (
                  <label key={field.key} className="grid gap-2">
                    {field.label}
                    <select
                      className="border-input bg-background min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
                      value={facts[field.key]}
                      onChange={(event) =>
                        setFacts({ ...facts, [field.key]: event.target.value })
                      }
                    >
                      <option value="">انتخاب مقدار متعارض</option>
                      {properties.map((id, index) => (
                        <option value={id} key={id}>
                          ملک {(index + 1).toLocaleString("fa-IR")}:{" "}
                          {factLabel(field.display_values[id])}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
          </section>
          <section
            className="rounded-xl border p-5"
            aria-labelledby="images-step"
            hidden={guided && step !== 2}
          >
            <h3 id="images-step" className="mb-3 font-semibold">
              ۳. تصاویر ملک
            </h3>
            <p className="text-muted-foreground mb-4 text-sm leading-7">
              تصاویر هر دو ملک؛ نخستین تصویر انتخاب‌شده تصویر اصلی خواهد بود.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {comparison.property_images.map((image, index) => (
                <label
                  key={image.id}
                  className="space-y-2 rounded-md border p-3"
                >
                  <img
                    src={image.url}
                    alt={`تصویر ${(index + 1).toLocaleString("fa-IR")} ملک ${properties.indexOf(image.property_id) + 1}`}
                    className="h-40 w-full rounded object-cover"
                  />
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`انتخاب تصویر ${(index + 1).toLocaleString("fa-IR")}`}
                      checked={images.includes(image.id)}
                      onChange={(event) => {
                        setImages(
                          event.target.checked
                            ? [...images, image.id]
                            : images.filter((id) => id !== image.id),
                        );
                        setImagesConfirmed(false);
                      }}
                    />
                    ملک {properties.indexOf(image.property_id) + 1}، تصویر{" "}
                    {index + 1}
                  </span>
                </label>
              ))}
            </div>
            {!comparison.property_images.length && (
              <p>هیچ تصویر ملک ثبت نشده است.</p>
            )}
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={imagesConfirmed}
                onChange={(event) => setImagesConfirmed(event.target.checked)}
              />
              انتخاب تصاویر را تأیید می‌کنم
            </label>
            <p className="text-muted-foreground mt-2 text-sm">
              انتخاب خالی یعنی ملک باقی‌مانده بدون تصویر نمایش داده می‌شود.
              تصاویر آگهی‌ها و سوابق حفظ می‌شوند.
            </p>
          </section>
          {warning && (!guided || step === 2) && (
            <Alert variant="destructive">
              <AlertTitle>شواهد ضعیف یا متعارض</AlertTitle>
              <AlertDescription>
                <p>
                  امتیاز پایین یا مانع جدی وجود دارد. پیش از گروه‌بندی، شواهد هر
                  دو ملک را بررسی کنید.
                </p>
                <label className="mt-3 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={warningConfirmed}
                    onChange={(event) =>
                      setWarningConfirmed(event.target.checked)
                    }
                  />
                  با آگاهی از هشدار، گروه‌بندی را تأیید می‌کنم
                </label>
              </AlertDescription>
            </Alert>
          )}
          <label
            hidden={guided && step !== 2}
            className={guided && step !== 2 ? "hidden" : "grid gap-2"}
          >
            دلیل (اختیاری)
            <textarea
              className="border-input bg-background min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
              maxLength={4000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {suggestionId ? (
            <label className="grid max-w-xs gap-2">
              مدت تعویق
              <select
                className="w-full rounded-md border p-2"
                value={snoozeDays}
                onChange={(event) =>
                  setSnoozeDays(Number(event.target.value) as 1 | 7 | 30)
                }
              >
                <option value={1}>۱ روز</option>
                <option value={7}>۷ روز</option>
                <option value={30}>۳۰ روز</option>
              </select>
            </label>
          ) : null}
        </fieldset>
        {guided ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              disabled={step === 0 || busy}
              onClick={() => setStep(step - 1)}
            >
              مرحله قبل
            </Button>
            <p className="text-muted-foreground text-sm" role="status">
              مرحله {(step + 1).toLocaleString("fa-IR")} از ۳
            </p>
            {step < 2 ? (
              <Button
                disabled={
                  busy ||
                  !claimId ||
                  (step === 0 && !survivorConfirmed) ||
                  (step === 1 && Object.values(facts).some((value) => !value))
                }
                onClick={() => setStep(step + 1)}
              >
                مرحله بعد
              </Button>
            ) : (
              <span />
            )}
          </div>
        ) : null}
        <div
          className={
            guided && step !== 2
              ? "hidden"
              : "bg-muted/30 flex flex-wrap gap-3 rounded-xl border p-4"
          }
        >
          <Button
            type="button"
            disabled={
              busy ||
              !claimId ||
              !survivorConfirmed ||
              !imagesConfirmed ||
              (warning && !warningConfirmed) ||
              Object.values(facts).some((value) => !value)
            }
            onClick={() => approve.mutate()}
          >
            تأیید و گروه‌بندی
          </Button>
          {suggestionId ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !claimId}
                onClick={() => reject.mutate()}
              >
                این دو ملک متفاوت‌اند
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !claimId}
                onClick={() => snooze.mutate()}
              >
                تعویق پیشنهاد
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
