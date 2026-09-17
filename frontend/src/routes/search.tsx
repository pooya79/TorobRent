import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { useLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";

import { propertySearchInfiniteQueryOptions } from "@/features/catalog/queries";
import { ResultsPage } from "@/pages/ResultsPage";

export { meta } from "@/pages/ResultsPage";

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Pagination is already fetched into the client cache. Rehydrating page one
  // here would discard the accumulated pages and fetch them all again.
  if (
    !formMethod &&
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.searchParams.get("page") !== nextUrl.searchParams.get("page")
  ) {
    const current = new URLSearchParams(currentUrl.search);
    const next = new URLSearchParams(nextUrl.search);
    current.delete("page");
    next.delete("page");
    if (current.toString() === next.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ request }: { request: Request }) {
  const requestUrl = new URL(request.url);
  const baseUrl =
    typeof window === "undefined"
      ? (process.env.VITE_PROXY_TARGET ?? requestUrl.origin)
      : requestUrl.origin;
  const queryClient = new QueryClient();
  try {
    await queryClient.prefetchInfiniteQuery(
      propertySearchInfiniteQueryOptions(requestUrl.searchParams, baseUrl),
    );
  } catch {
    // Preserve the client-side retry and error states when the catalog is down.
  }
  return { dehydratedState: dehydrate(queryClient) };
}

export default function SearchRoute() {
  const { dehydratedState } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydratedState}>
      <ResultsPage />
    </HydrationBoundary>
  );
}
