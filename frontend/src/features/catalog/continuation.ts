import { api } from "@/lib/api/client";

const EVENT_SESSION_KEY = "torobrent:event-session";
let memoryEventSession: string | undefined;

export class ContinuationError extends Error {
  constructor(readonly status: number) {
    super("Listing continuation failed");
  }
}

function eventSession(): string {
  if (memoryEventSession) return memoryEventSession;
  try {
    const stored = window.sessionStorage.getItem(EVENT_SESSION_KEY);
    if (stored) {
      memoryEventSession = stored;
      return stored;
    }
  } catch {
    // A per-page in-memory token still provides deduplication when storage is unavailable.
  }
  memoryEventSession = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(EVENT_SESSION_KEY, memoryEventSession);
  } catch {
    // The token intentionally remains ephemeral.
  }
  return memoryEventSession;
}

function eventHeaders() {
  return { "X-TorobRent-Event-Session": eventSession() };
}

export async function recordPropertyView(propertyId: string) {
  const { response } = await api.POST(
    "/api/v1/catalog/properties/{property_id}/view/",
    {
      params: {
        path: { property_id: propertyId },
        header: eventHeaders(),
      },
    },
  );
  if (!response.ok) throw new ContinuationError(response.status);
}

export async function revealListingPhone(listingId: string) {
  const { data, response } = await api.POST(
    "/api/v1/catalog/listings/{listing_id}/phone-reveal/",
    {
      params: {
        path: { listing_id: listingId },
        header: eventHeaders(),
      },
    },
  );
  if (!data) throw new ContinuationError(response.status);
  return data.phone;
}

export async function resolveExternalContinuation(listingId: string) {
  const { data, response } = await api.POST(
    "/api/v1/catalog/listings/{listing_id}/continuation/",
    {
      params: {
        path: { listing_id: listingId },
        header: eventHeaders(),
      },
    },
  );
  if (!data) throw new ContinuationError(response.status);
  return data.url;
}
