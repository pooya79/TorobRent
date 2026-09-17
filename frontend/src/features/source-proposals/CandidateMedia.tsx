import type { components } from "@/lib/api/schema";

type Image = components["schemas"]["CandidateImage"];

export function CandidateMedia({ images }: { images: Image[] }) {
  return (
    <section className="grid gap-3" aria-label="تصاویر منبع">
      {images.map((image, index) => {
        const thumbnail = image.variants.find(
          (variant) => variant.kind === "small",
        )?.url;
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
          </div>
        );
      })}
    </section>
  );
}
