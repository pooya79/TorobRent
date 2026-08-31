import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supportedCitiesQueryOptions } from "./queries";

export type SelectedSupportedCity = {
  id: string;
  name: string;
};

function matchesCity(cityName: string, query: string) {
  return cityName
    .replaceAll("‌", "")
    .includes(query.trim().replaceAll("‌", ""));
}

export function SupportedCityCombobox({
  onSelectionChange,
  initialCity = null,
  showPopularCities = false,
  showUpcoming = false,
}: {
  onSelectionChange: (city: SelectedSupportedCity | null) => void;
  initialCity?: SelectedSupportedCity | null;
  showPopularCities?: boolean;
  showUpcoming?: boolean;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState(initialCity?.name ?? "");
  const [committedCity, setCommittedCity] = useState(initialCity);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const cities = useQuery(supportedCitiesQueryOptions());
  const matchingCities = (cities.data ?? []).filter((city) =>
    matchesCity(city.name, query),
  );
  const upcomingCities = ["مشهد", "اصفهان", "شیراز", "کرج", "تبریز"].filter(
    (city) => matchesCity(city, query),
  );
  const popularUpcomingCities = ["اصفهان", "مشهد", "شیراز", "تبریز"];
  const showingPopularCities = showPopularCities && query.trim() === "";
  const popularSupportedCity = (cities.data ?? []).find(
    (city) => city.name === "تهران",
  );
  const activeCity =
    activeIndex === null ? undefined : matchingCities[activeIndex];

  const selectCity = (city: SelectedSupportedCity) => {
    setQuery(city.name);
    setCommittedCity(city);
    setOpen(false);
    setActiveIndex(null);
    onSelectionChange(city);
  };

  return (
    <>
      <Input
        className="h-auto rounded-none border-0 bg-transparent p-0 text-sm leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={
          open &&
          cities.isSuccess &&
          (matchingCities.length > 0 ||
            showingPopularCities ||
            (showUpcoming && upcomingCities.length > 0))
            ? listboxId
            : undefined
        }
        aria-activedescendant={
          activeCity ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-expanded={
          open &&
          cities.isSuccess &&
          (matchingCities.length > 0 ||
            showingPopularCities ||
            (showUpcoming && upcomingCities.length > 0))
        }
        aria-label="شهر"
        placeholder="تهران"
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setCommittedCity(null);
          setOpen(true);
          setActiveIndex(null);
          onSelectionChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery(committedCity?.name ?? "");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setActiveIndex(null);
            return;
          }
          if (event.key === "ArrowDown" && matchingCities.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              current === null ? 0 : (current + 1) % matchingCities.length,
            );
            return;
          }
          if (event.key === "ArrowUp" && matchingCities.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              current === null
                ? matchingCities.length - 1
                : (current - 1 + matchingCities.length) % matchingCities.length,
            );
            return;
          }
          if (event.key === "Enter" && activeCity) {
            event.preventDefault();
            selectCity(activeCity);
          }
        }}
      />
      {open && (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-xl border p-1 shadow-md">
          {cities.isPending && (
            <p
              className="text-muted-foreground px-3 py-2 text-sm"
              role="status"
              aria-label="در حال دریافت شهرها"
            >
              در حال دریافت شهرها…
            </p>
          )}
          {cities.isError && (
            <div
              className="text-destructive flex items-center justify-between gap-2 px-3 py-2 text-sm"
              role="alert"
              aria-label="دریافت شهرها ممکن نشد. دوباره تلاش کنید."
            >
              <span>دریافت شهرها ممکن نشد. دوباره تلاش کنید.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void cities.refetch()}
              >
                تلاش دوباره
              </Button>
            </div>
          )}
          {cities.isSuccess &&
            matchingCities.length === 0 &&
            !showingPopularCities &&
            (!showUpcoming || upcomingCities.length === 0) && (
              <p
                className="text-muted-foreground px-3 py-2 text-sm"
                role="status"
                aria-label="شهری پیدا نشد"
              >
                شهری پیدا نشد.
              </p>
            )}
          {cities.isSuccess && showingPopularCities && (
            <div>
              <p className="px-3 py-2 text-sm font-semibold">شهرهای محبوب</p>
              <div className="border-border mx-2 border-t" />
              <ul
                id={listboxId}
                role="listbox"
                aria-label="شهرهای محبوب"
                className="pt-1"
              >
                {popularSupportedCity && (
                  <li key={popularSupportedCity.id} role="none">
                    <button
                      id={`${listboxId}-option-0`}
                      className="hover:bg-accent focus-visible:bg-accent min-h-11 w-full rounded-lg px-3 text-start text-sm"
                      type="button"
                      role="option"
                      aria-selected="false"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCity(popularSupportedCity)}
                    >
                      {popularSupportedCity.label}
                    </button>
                  </li>
                )}
                {popularUpcomingCities.map((city) => (
                  <li key={city} role="none">
                    <button
                      className="text-muted-foreground min-h-11 w-full cursor-not-allowed rounded-lg px-3 text-start text-sm"
                      type="button"
                      role="option"
                      aria-disabled="true"
                      aria-selected="false"
                      disabled
                    >
                      {city} (به‌زودی)
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cities.isSuccess &&
            !showingPopularCities &&
            (matchingCities.length > 0 ||
              (showUpcoming && upcomingCities.length > 0)) && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="شهرهای قابل جست‌وجو"
              >
                {matchingCities.length > 0 && (
                  <li role="group" aria-label="فعال">
                    <ul role="none">
                      {matchingCities.map((city, index) => (
                        <li key={city.id} role="none">
                          <button
                            id={`${listboxId}-option-${index}`}
                            className="hover:bg-accent focus-visible:bg-accent min-h-11 w-full rounded-lg px-3 text-start text-sm"
                            type="button"
                            role="option"
                            aria-selected={city.name === query}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectCity(city)}
                          >
                            {city.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
                {showUpcoming && upcomingCities.length > 0 && (
                  <li
                    className="mt-1 border-t pt-1"
                    role="group"
                    aria-label="به‌زودی"
                  >
                    <p className="text-muted-foreground px-3 py-1 text-xs">
                      به‌زودی
                    </p>
                    <ul role="none">
                      {upcomingCities.map((city) => (
                        <li key={city} role="none">
                          <button
                            className="text-muted-foreground min-h-11 w-full cursor-not-allowed rounded-lg px-3 text-start text-sm"
                            type="button"
                            role="option"
                            aria-disabled="true"
                            aria-selected="false"
                            disabled
                          >
                            {city} — به‌زودی
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            )}
        </div>
      )}
    </>
  );
}
