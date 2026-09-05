import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/schema";

export type MediaChoice = components["schemas"]["CandidateImageChoice"];
type Image = components["schemas"]["CandidateImage"];

export function CandidateMedia({
  images,
  choices,
  onChange,
}: {
  images: Image[];
  choices?: MediaChoice[];
  onChange?: (choices: MediaChoice[]) => void;
}) {
  const ordered =
    choices?.map((choice) => images.find((image) => image.id === choice.id)!) ??
    images;
  function update(id: string, change: Partial<MediaChoice>) {
    if (!choices || !onChange) return;
    const next = choices.map((choice) =>
      choice.id === id
        ? { ...choice, ...change }
        : change.is_primary
          ? { ...choice, is_primary: false }
          : choice,
    );
    if (!next.some((choice) => choice.is_primary)) {
      const primary = next.find(
        (choice) =>
          !choice.excluded &&
          images.find((image) => image.id === choice.id)?.state === "ready",
      );
      if (primary) primary.is_primary = true;
    }
    onChange(next);
  }
  return (
    <section className="grid gap-3" aria-label="تصاویر منبع">
      {ordered.map((image, index) => {
        const thumbnail = image.variants.find(
          (variant) => variant.kind === "small",
        )?.url;
        const choice = choices?.find((item) => item.id === image.id);
        return (
          <div key={image.id} className="grid gap-2 rounded border p-3">
            {thumbnail && (
              <img
                src={thumbnail}
                alt={`تصویر ${(index + 1).toLocaleString("fa-IR")}`}
                className="h-32 w-48 rounded object-cover"
                loading="lazy"
              />
            )}
            {image.state === "failed" && (
              <p role="status">
                دریافت یا پردازش تصویر ناموفق بود ({image.failure_code})
              </p>
            )}
            {image.state === "retired" && (
              <p>مهلت نگهداری تصویر پایان یافته است.</p>
            )}
            {choice && onChange && choices && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === 0}
                  aria-label={`تصویر ${(index + 1).toLocaleString("fa-IR")} به بالا`}
                  onClick={() => {
                    const next = [...choices];
                    [next[index - 1], next[index]] = [
                      next[index]!,
                      next[index - 1]!,
                    ];
                    onChange(next);
                  }}
                >
                  به بالا
                </Button>
                <label>
                  <input
                    type="checkbox"
                    checked={choice.excluded}
                    onChange={(event) =>
                      update(image.id, {
                        excluded: event.target.checked,
                        is_primary: false,
                        accept_as_property: false,
                      })
                    }
                  />{" "}
                  حذف از انتشار
                </label>
                <label>
                  <input
                    type="radio"
                    name={`primary-${images[0]?.id}`}
                    checked={choice.is_primary}
                    disabled={choice.excluded || image.state !== "ready"}
                    onChange={() => update(image.id, { is_primary: true })}
                  />{" "}
                  تصویر اصلی
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={choice.accept_as_property}
                    disabled={choice.excluded || image.state !== "ready"}
                    onChange={(event) =>
                      update(image.id, {
                        accept_as_property: event.target.checked,
                      })
                    }
                  />{" "}
                  پذیرش به عنوان تصویر ملک
                </label>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
