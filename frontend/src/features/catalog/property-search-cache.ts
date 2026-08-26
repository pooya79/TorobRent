import type { InfiniteData } from "@tanstack/react-query";

import type { components } from "@/lib/api/schema";

export type PropertySearchPage = components["schemas"]["PropertySearchPage"];
type InfinitePropertySearchPage = PropertySearchPage & {
  requestSearchParams: string;
};
export type PropertySearchData =
  PropertySearchPage | InfiniteData<InfinitePropertySearchPage, string | null>;

export function mapPropertySearchPages(
  data: PropertySearchData | undefined,
  transform: (page: PropertySearchPage) => PropertySearchPage,
): PropertySearchData | undefined {
  if (!data) return data;
  if ("pages" in data) {
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...transform(page),
        requestSearchParams: page.requestSearchParams,
      })),
    };
  }
  return transform(data);
}
