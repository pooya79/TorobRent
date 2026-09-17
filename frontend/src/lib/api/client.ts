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
      if (
        request.method !== "GET" &&
        new URL(request.url).pathname.startsWith(
          "/api/v1/operator/source-proposals/",
        )
      ) {
        const path = new URL(request.url).pathname;
        const section = path.includes("/profile/")
          ? "profile"
          : /\/(processing|crawl|publication-mode)\/$/.test(path)
            ? "processing"
            : path.endsWith("/approve/") && !path.includes("/runs/")
              ? "url"
              : "overview";
        request.headers.set("X-Source-Case-Section", section);
      }
      return request;
    },
  });
  return client;
}

export const api = createApiClient(
  typeof window === "undefined" ? "" : window.location.origin,
);
