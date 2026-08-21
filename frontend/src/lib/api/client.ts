import createClient from "openapi-fetch";

import type { paths } from "@/lib/api/schema";

let csrfToken: string | undefined;

export function rememberCsrfToken(token: string) {
  csrfToken = token;
}

export const api = createClient<paths>({
  baseUrl: window.location.origin,
  credentials: "include",
});

api.use({
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
