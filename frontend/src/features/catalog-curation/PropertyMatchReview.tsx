import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Comparison = components["schemas"]["PropertyComparison"];

function factLabel(value: unknown): string {
  if (value == null || value === "") return "نامشخص";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString("fa-IR");
  return JSON.stringify(value);
}

export function PropertyMatchReview({
  comparison,
  onRefresh,
}: {
  comparison: Comparison;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
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
  const [claimId, setClaimId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(
    comparison.claim?.expires_at ?? null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const properties = comparison.properties.map((property) => property.id);
  const warning =
    comparison.band === "below_threshold" ||
    comparison.signals.some((signal) => signal.classification === "blocker");
  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/operator/catalog-curation/claim/",
        {
          body: { properties, revision: comparison.revision },
        },
      );
      if (error || !data?.claim)
        throw new Error(
          "بررسی در اختیار شما نیست یا شواهد تغییر کرده است. مقایسه را تازه کنید.",
        );
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
          },
        },
      );
      if (error || !data) {
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
      setCompleted(data.survivor_id);
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
          <p role="status">گروه‌بندی ثبت شد.</p>
          <a
            className="text-primary underline"
            href={`/properties/${completed}`}
          >
            مشاهده ملک باقی‌مانده
          </a>
        </CardContent>
      </Card>
    );
  const busy = claim.isPending || approve.isPending;
  return (
    <Card>
      <CardHeader>
        <CardTitle>تصمیم تطبیق ملک</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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
        <fieldset disabled={!claimId || busy} className="min-w-0 space-y-5">
          <label className="grid gap-2">
            ملک باقی‌مانده
            <select
              className="w-full min-w-0 rounded-md border p-2"
              value={survivor}
              onChange={(event) => {
                setSurvivor(event.target.value);
                setSurvivorConfirmed(false);
              }}
            >
              {properties.map((id, index) => (
                <option value={id} key={id}>
                  ملک {index + 1} — {id}
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
          <div className="grid gap-4 md:grid-cols-2">
            {comparison.decision_fields.map((field) => (
              <label key={field.key} className="grid gap-2">
                {field.label}
                <select
                  className="w-full min-w-0 rounded-md border p-2"
                  value={facts[field.key]}
                  onChange={(event) =>
                    setFacts({ ...facts, [field.key]: event.target.value })
                  }
                >
                  <option value="">انتخاب مقدار متعارض</option>
                  {properties.map((id, index) => (
                    <option value={id} key={id}>
                      ملک {index + 1}: {factLabel(field.display_values[id])}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div>
            <p className="mb-3 font-medium">
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
          </div>
          {warning && (
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
          <label className="grid gap-2">
            دلیل (اختیاری)
            <textarea
              className="w-full min-w-0 rounded-md border p-2"
              maxLength={4000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </fieldset>
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
      </CardContent>
    </Card>
  );
}
