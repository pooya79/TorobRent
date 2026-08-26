import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { locationAutocompleteQueryOptions } from "./queries";

export type SelectedArea = { id: string; label: string };

export function LocationMultiSelect({
  kind,
  label,
  selected,
  onSelectionChange,
}: {
  kind: "district" | "neighborhood";
  label: string;
  selected: SelectedArea[];
  onSelectionChange: (areas: SelectedArea[]) => void;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const suggestions = useQuery(locationAutocompleteQueryOptions(query));
  const options = (suggestions.data ?? []).filter(
    (suggestion) =>
      suggestion.kind === kind &&
      !selected.some((area) => area.id === suggestion.id),
  );
  const activeOption = activeIndex === null ? undefined : options[activeIndex];
  const selectOption = (option: (typeof options)[number]) => {
    onSelectionChange([...selected, { id: option.id, label: option.label }]);
    setQuery("");
    setOpen(false);
    setActiveIndex(null);
  };

  return (
    <div className="relative space-y-2">
      <Input
        type="search"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={open && options.length > 0 ? listboxId : undefined}
        aria-activedescendant={
          activeOption ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-expanded={open && options.length > 0}
        placeholder={`${label} را جست‌وجو کنید`}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setOpen(true);
          setActiveIndex(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setActiveIndex(null);
            return;
          }
          if (event.key === "ArrowDown" && options.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              index === null ? 0 : (index + 1) % options.length,
            );
            return;
          }
          if (event.key === "ArrowUp" && options.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              index === null
                ? options.length - 1
                : (index - 1 + options.length) % options.length,
            );
            return;
          }
          if (event.key === "Enter" && activeOption) {
            event.preventDefault();
            selectOption(activeOption);
          }
        }}
      />
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`${label} انتخاب‌شده`}>
          {selected.map((area) => (
            <li key={area.id}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`حذف ${area.label}`}
                onClick={() =>
                  onSelectionChange(
                    selected.filter((candidate) => candidate.id !== area.id),
                  )
                }
              >
                {area.label}
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && (
        <div className="border-border bg-popover absolute z-30 mt-1 w-full rounded-lg border p-1 shadow-md">
          {suggestions.isPending && (
            <p
              className="text-muted-foreground px-3 py-2 text-sm"
              role="status"
            >
              در حال جست‌وجو…
            </p>
          )}
          {suggestions.isError && (
            <p className="text-destructive px-3 py-2 text-sm" role="alert">
              جست‌وجوی محدوده ممکن نشد.
            </p>
          )}
          {suggestions.isSuccess && options.length === 0 && (
            <p
              className="text-muted-foreground px-3 py-2 text-sm"
              role="status"
            >
              موردی پیدا نشد.
            </p>
          )}
          {options.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              aria-multiselectable="true"
            >
              {options.map((option, index) => (
                <li key={option.id} role="none">
                  <button
                    id={`${listboxId}-option-${index}`}
                    className={`hover:bg-accent focus-visible:bg-accent min-h-11 w-full rounded-md px-3 text-start text-sm ${
                      activeIndex === index ? "bg-accent" : ""
                    }`}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
