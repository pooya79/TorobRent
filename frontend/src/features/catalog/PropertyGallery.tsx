import { useState } from "react";
import { Building2, Images, MapPin } from "lucide-react";
import type { components } from "@/lib/api/schema";

type Property = components["schemas"]["PropertyDetail"];
export function PropertyGallery({ property }: { property: Property }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const media = [
    ...(property.images ?? []).map((image) => ({
      ...image,
      id: `property-${image.id}`,
      source: "تصاویر ملک",
      isPropertyImage: true,
    })),
    ...property.listings.flatMap((listing) =>
      (listing.images ?? []).map((image) => ({
        ...image,
        id: `${listing.id}-${image.id}`,
        source: listing.source.display_name,
        isPropertyImage: false,
      })),
    ),
  ];
  const images = media
    .flatMap((image) => {
      const variant =
        image.variants.find((candidate) => candidate.kind === "medium") ??
        image.variants[0];
      return variant && !failedUrls.includes(variant.url)
        ? [
            {
              ...variant,
              id: image.id,
              source: image.source,
              isPropertyImage: image.isPropertyImage,
            },
          ]
        : [];
    })
    .filter(
      (image, index, all) =>
        all.findIndex((other) => other.url === image.url) === index,
    );
  const selected = images[selectedIndex] ?? images[0];
  return (
    <section
      aria-label="تصاویر ملک"
      className="overflow-hidden rounded-2xl border"
    >
      {selected ? (
        <>
          <div className="bg-muted relative">
            <img
              className="aspect-[16/9] max-h-[480px] w-full object-cover"
              src={selected.url}
              alt={
                selected.isPropertyImage
                  ? "تصویر ملک"
                  : `تصویر ملک از ${selected.source}`
              }
              onError={() => setFailedUrls((urls) => [...urls, selected.url])}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/75 to-transparent px-5 pt-12 pb-4 text-white">
              <p className="text-xs">
                {selected.isPropertyImage
                  ? selected.source
                  : `تصویر از ${selected.source}`}
              </p>
              <span className="flex items-center gap-2 text-sm">
                <Images className="size-4" aria-hidden="true" />
                {new Intl.NumberFormat("fa-IR").format(images.length)} تصویر
              </span>
            </div>
          </div>
          {!selected.isPropertyImage && (
            <div className="bg-muted/40 space-y-1 border-t px-5 py-3">
              <p className="text-sm font-medium">
                تصویر آگهی؛ تاییدنشده به عنوان تصویر ملک
              </p>
              <p className="text-muted-foreground text-xs leading-6">
                این تصویر از آگهی منبع است و هنوز به عنوان تصویر ملک تایید نشده
                است. فقط تصاویر تاییدشده ملک می‌توانند تصویر اصلی در نتایج جستجو
                باشند.
              </p>
            </div>
          )}
          {images.length > 1 && (
            <div className="bg-card flex gap-2 overflow-x-auto p-3">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={`نمایش تصویر ${index + 1} از ${image.source}`}
                  aria-pressed={image.id === selected.id}
                  onClick={() => setSelectedIndex(index)}
                  className={`shrink-0 overflow-hidden rounded-lg border-2 p-0.5 ${image.id === selected.id ? "border-primary" : "border-transparent"}`}
                >
                  <img
                    className="h-16 w-24 rounded-md object-cover"
                    src={image.url}
                    alt=""
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="from-primary/10 via-muted/30 to-background relative flex min-h-56 items-center gap-6 bg-gradient-to-bl p-6 sm:p-10">
          <div className="bg-background/80 text-primary rounded-2xl border p-5">
            <Building2
              className="size-12 sm:size-16"
              strokeWidth={1}
              aria-hidden="true"
            />
          </div>
          <div>
            <p className="text-lg font-semibold">
              {property.property_type_label} در {property.location.neighborhood}
            </p>
            <p className="text-muted-foreground mt-2 text-sm leading-7">
              تصویری برای این ملک در دسترس نیست
            </p>
            <p className="text-muted-foreground mt-4 flex items-center gap-1 text-xs">
              <MapPin className="size-3.5" aria-hidden="true" />
              {property.location.city}، {property.location.district}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
