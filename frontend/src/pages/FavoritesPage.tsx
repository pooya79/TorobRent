import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Heart } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { AccountWorkspace } from "@/features/account/AccountWorkspace";
import { SavedPropertyCard } from "@/features/catalog/SavedPropertyCard";
import { favoritesQueryOptions } from "@/features/catalog/queries";
import { formatNumber } from "@/features/catalog/property-card-data";

export function FavoritesPage() {
  const favorites = useQuery(favoritesQueryOptions());
  const count = favorites.data
    ? favorites.data.active.length + favorites.data.unavailable.length
    : undefined;

  return (
    <AccountWorkspace>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              علاقه‌مندی‌ها
            </h1>
            {count !== undefined && count > 0 && (
              <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs">
                {formatNumber(count)} ملک
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            ملک‌هایی که برای بعد نگه داشته‌اید.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/search">
            جست‌وجوی ملک <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
      </header>
      {favorites.isPending ? (
        <div
          role="status"
          aria-label="در حال بارگذاری علاقه‌مندی‌ها"
          className="grid gap-3 xl:grid-cols-2"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="bg-card flex gap-4 rounded-2xl border p-4 motion-safe:animate-pulse"
            >
              <div className="bg-muted h-28 w-24 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-3 py-2">
                <div className="bg-muted h-4 w-3/4 rounded" />
                <div className="bg-muted h-3 w-1/2 rounded" />
                <div className="bg-muted mt-6 h-4 w-2/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : favorites.isError ? (
        <div
          role="alert"
          className="bg-card rounded-2xl border p-8 text-center"
        >
          <p>علاقه‌مندی‌ها بارگذاری نشد.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void favorites.refetch()}
          >
            تلاش دوباره
          </Button>
        </div>
      ) : count === 0 ? (
        <div className="bg-card rounded-2xl border border-dashed px-6 py-16 text-center">
          <span className="bg-primary/5 text-primary mx-auto mb-5 flex size-14 items-center justify-center rounded-full">
            <Heart className="size-6" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold">هنوز ملکی ذخیره نکرده‌اید</h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-72 text-sm leading-7">
            با زدن قلب کنار هر ملک، آن را اینجا نگه دارید.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/search">
              دیدن ملک‌ها <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {favorites.data.active.length > 0 && (
            <section aria-labelledby="active-favorites-heading">
              <h2 id="active-favorites-heading" className="sr-only">
                ملک‌های در دسترس
              </h2>
              <div className="grid gap-3 xl:grid-cols-2">
                {favorites.data.active.map((property) => (
                  <SavedPropertyCard
                    key={property.id}
                    property={property}
                    available
                  />
                ))}
              </div>
            </section>
          )}
          {favorites.data.unavailable.length > 0 && (
            <section aria-labelledby="unavailable-favorites-heading">
              <div className="mb-4">
                <h2
                  id="unavailable-favorites-heading"
                  className="text-sm font-semibold"
                >
                  فعلاً آگهی فعال ندارند
                </h2>
                <p className="text-muted-foreground mt-1 text-xs leading-6">
                  ذخیره می‌مانند تا دوباره آگهی شوند.
                </p>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {favorites.data.unavailable.map((property) => (
                  <SavedPropertyCard
                    key={property.id}
                    property={property}
                    available={false}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AccountWorkspace>
  );
}

export default FavoritesPage;
