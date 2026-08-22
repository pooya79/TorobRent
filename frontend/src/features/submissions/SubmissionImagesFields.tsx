import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api/errors";
import {
  removeSubmissionImage,
  reorderSubmissionImages,
  retrySubmissionImage,
  type Submission,
  type SubmissionImage,
  uploadSubmissionImage,
} from "./queries";

const imageStatusLabels = {
  pending: "در صف پردازش",
  processing: "در حال پردازش",
  ready: "آماده",
  failed: "پردازش ناموفق",
} as const;

export function submissionImagePreview(image: SubmissionImage) {
  return (
    image.variants.find((variant) => variant.kind === "medium") ??
    image.variants[0]
  );
}

export function SubmissionImagesFields({
  submission,
}: {
  submission: Submission;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["submissions", submission.id] as const;
  const updateImages = (images: SubmissionImage[]) =>
    queryClient.setQueryData<Submission>(queryKey, (current) =>
      current ? { ...current, images } : current,
    );
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded: SubmissionImage[] = [];
      for (const file of files) {
        uploaded.push(await uploadSubmissionImage(submission.id, file));
      }
      return uploaded;
    },
    onSuccess: (uploaded) => updateImages([...submission.images, ...uploaded]),
    onError: () =>
      queryClient.invalidateQueries({
        queryKey,
      }),
  });
  const orderMutation = useMutation({
    mutationFn: (input: { imageIds: string[]; primaryImageId: string }) =>
      reorderSubmissionImages(submission.id, {
        image_ids: input.imageIds,
        primary_image_id: input.primaryImageId,
      }),
    onSuccess: updateImages,
  });
  const removeMutation = useMutation({
    mutationFn: (imageId: string) =>
      removeSubmissionImage(submission.id, imageId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["submissions", submission.id],
      }),
  });
  const retryMutation = useMutation({
    mutationFn: ({ imageId, file }: { imageId: string; file: File }) =>
      retrySubmissionImage(submission.id, imageId, file),
    onSuccess: (retried) =>
      updateImages(
        submission.images.map((image) =>
          image.id === retried.id ? retried : image,
        ),
      ),
  });
  const operationError =
    uploadMutation.error ??
    orderMutation.error ??
    removeMutation.error ??
    retryMutation.error;
  const operationPending =
    uploadMutation.isPending ||
    orderMutation.isPending ||
    removeMutation.isPending ||
    retryMutation.isPending;
  const primaryId =
    submission.images.find((image) => image.is_primary)?.id ??
    submission.images[0]?.id;

  const moveToStart = (imageId: string) => {
    if (!primaryId) return;
    orderMutation.mutate({
      imageIds: [
        imageId,
        ...submission.images
          .filter((image) => image.id !== imageId)
          .map((image) => image.id),
      ],
      primaryImageId: primaryId,
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label
          className="border-border hover:bg-muted flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center"
          htmlFor="submission-images"
        >
          <ImagePlus aria-hidden="true" className="size-6" />
          <span>افزودن تصاویر</span>
          <span className="text-muted-foreground text-xs">
            JPEG، PNG یا WebP؛ حداکثر ۱۰ مگابایت برای هر فایل
          </span>
        </Label>
        <Input
          id="submission-images"
          aria-label="افزودن تصاویر"
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={operationPending || submission.images.length >= 12}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []).slice(
              0,
              12 - submission.images.length,
            );
            if (files.length > 0) uploadMutation.mutate(files);
            event.currentTarget.value = "";
          }}
        />
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {submission.images.length} از ۱۲ تصویر افزوده شده است.
        </p>
      </div>
      {operationError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {errorMessage(operationError, "تغییر تصاویر ممکن نشد.")}
          </AlertDescription>
        </Alert>
      )}
      {uploadMutation.isPending && (
        <p className="flex items-center gap-2 text-sm" role="status">
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          در حال بارگذاری تصاویر…
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {submission.images.map((image) => {
          const preview = submissionImagePreview(image);
          return (
            <li
              className="border-border overflow-hidden rounded-xl border"
              key={image.id}
            >
              <div className="bg-muted aspect-4/3">
                {preview ? (
                  <img
                    className="size-full object-cover"
                    src={preview.url}
                    alt="پیش‌نمایش تصویر"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <ImagePlus
                      aria-hidden="true"
                      className="text-muted-foreground size-8"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2" aria-live="polite">
                    {(image.status === "pending" ||
                      image.status === "processing") && (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    )}
                    {imageStatusLabels[image.status ?? "pending"]}
                  </span>
                  {image.is_primary && <Badge>تصویر اصلی</Badge>}
                </div>
                {image.failure_reason && (
                  <p className="text-destructive text-xs">
                    {image.failure_reason}
                  </p>
                )}
                <Label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="primary-image"
                    aria-label="انتخاب به‌عنوان تصویر اصلی"
                    checked={image.is_primary}
                    disabled={operationPending}
                    onChange={() =>
                      orderMutation.mutate({
                        imageIds: submission.images.map((item) => item.id),
                        primaryImageId: image.id,
                      })
                    }
                  />
                  تصویر اصلی
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={operationPending || image.position === 0}
                    onClick={() => moveToStart(image.id)}
                  >
                    <ArrowUp aria-hidden="true" /> انتقال به ابتدا
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={operationPending}
                    onClick={() => removeMutation.mutate(image.id)}
                  >
                    <Trash2 aria-hidden="true" /> حذف تصویر
                  </Button>
                </div>
                {image.status === "failed" && (
                  <Label className="border-border flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm">
                    <RotateCcw aria-hidden="true" /> جایگزینی و تلاش دوباره
                    <Input
                      className="sr-only"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={operationPending}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file)
                          retryMutation.mutate({ imageId: image.id, file });
                        event.currentTarget.value = "";
                      }}
                    />
                  </Label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
