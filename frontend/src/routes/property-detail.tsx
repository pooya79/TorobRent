import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { redirect, useLoaderData, useNavigate } from "react-router";

import {
  propertyDetailQueryOptions,
  PropertyUnavailableError,
} from "@/features/catalog/queries";
import type { components } from "@/lib/api/schema";
import { PropertyDetailPage } from "@/pages/PropertyDetailPage";
import { useRenterAccess } from "@/features/session/RenterAccessDialog";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";

type PropertyDetail = components["schemas"]["PropertyDetail"];

function throwRouteResponse(response: Response): never {
  // React Router uses thrown Responses for redirects and HTTP error boundaries.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw response;
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { propertyId?: string; slug?: string };
}) {
  const propertyId = params.propertyId;
  if (!propertyId) {
    throwRouteResponse(
      new Response("Property identity is required", { status: 404 }),
    );
  }
  const requestUrl = new URL(request.url);
  const requestOrigin = requestUrl.origin;
  const baseUrl =
    typeof window === "undefined"
      ? (process.env.VITE_PROXY_TARGET ?? requestOrigin)
      : requestOrigin;
  const queryClient = new QueryClient();
  let property: PropertyDetail;
  try {
    property = await queryClient.fetchQuery(
      propertyDetailQueryOptions(baseUrl, propertyId),
    );
  } catch (error) {
    if (error instanceof PropertyUnavailableError) {
      throwRouteResponse(new Response(error.message, { status: error.status }));
    }
    throw error;
  }
  if (params.slug !== property.canonical_slug) {
    throwRouteResponse(
      redirect(
        `${encodeURI(`/properties/${property.id}/${property.canonical_slug}`)}${requestUrl.search}`,
        301,
      ),
    );
  }
  return {
    baseUrl,
    dehydratedState: dehydrate(queryClient),
    property,
    returnTo: requestUrl.searchParams.get("returnTo"),
  };
}

export function meta({
  loaderData,
}: {
  loaderData?: { property: PropertyDetail };
}) {
  if (!loaderData) return [];
  const { property } = loaderData;
  const title = `${property.title} | ترب‌رنت`;
  const description = `${property.property_type_label} ${property.area_sqm} متری برای اجاره در ${property.location.neighborhood} تهران`;
  const canonicalPath = `/properties/${property.id}/${property.canonical_slug}`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonicalPath },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonicalPath },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

export default function PropertyDetailRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const baseUrl =
    typeof window === "undefined" ? loaderData.baseUrl : window.location.origin;
  return (
    <HydrationBoundary state={loaderData.dehydratedState}>
      <PropertyDetailQuery
        baseUrl={baseUrl}
        propertyId={loaderData.property.id}
        returnTo={loaderData.returnTo}
      />
    </HydrationBoundary>
  );
}

function PropertyDetailQuery({
  baseUrl,
  propertyId,
  returnTo,
}: {
  baseUrl: string;
  propertyId: string;
  returnTo: string | null;
}) {
  const { data: property } = useSuspenseQuery(
    propertyDetailQueryOptions(baseUrl, propertyId),
  );
  const session = useQuery(sessionQuery);
  const currentUser = useQuery({
    ...currentUserQuery,
    enabled: session.data?.authenticated === true,
  });
  const { requestRenterAccess } = useRenterAccess();
  const navigate = useNavigate();
  return (
    <PropertyDetailPage
      property={property}
      returnTo={returnTo}
      account={{
        authenticated: session.data?.authenticated === true,
        verified: Boolean(
          currentUser.data?.email_verified || currentUser.data?.phone_verified,
        ),
        displayName: currentUser.data?.display_name ?? "",
      }}
      onRequestAccess={requestRenterAccess}
      onNavigateMessage={(href) => void navigate(href)}
    />
  );
}
