import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { propertySearchPage } from "./fixtures/catalog";

export const server = setupServer(
  http.get("*/api/v1/auth/session/", () =>
    HttpResponse.json({ authenticated: false, csrf_token: "test-token" }),
  ),
  http.get("*/api/v1/system/ready/", () => HttpResponse.json({ status: "ok" })),
  http.get("*/api/v1/catalog/locations/", () =>
    HttpResponse.json([
      {
        id: "30000000-0000-4000-8000-000000000043",
        kind: "neighborhood",
        name: "سعادت‌آباد",
        label: "سعادت‌آباد، منطقه ۲، تهران",
      },
    ]),
  ),
  http.get("*/api/v1/catalog/properties/", () =>
    HttpResponse.json(propertySearchPage),
  ),
);
