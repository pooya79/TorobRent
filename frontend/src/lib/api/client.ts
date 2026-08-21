import createClient from "openapi-fetch";

import type { paths } from "@/lib/api/schema";

let csrfToken: string | undefined;

export function rememberCsrfToken(token: string) {
  csrfToken = token;
}

export function createApiClient(baseUrl: string) {
  const client = createClient<paths>({ baseUrl, credentials: "include" });
  client.use({
    onRequest({ request }) {
      if (
        !["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method) &&
        csrfToken
      ) {
        request.headers.set("X-CSRFToken", csrfToken);
      }
      return request;
    },
  });
  return client;
}

export const api = createApiClient(
  typeof window === "undefined" ? "" : window.location.origin,
);
