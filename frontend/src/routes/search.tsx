import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { useLoaderData } from "react-router";

import { propertySearchInfiniteQueryOptions } from "@/features/catalog/queries";
import { ResultsPage } from "@/pages/ResultsPage";

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
