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
  http.get("*/api/v1/catalog/supported-cities/", () =>
    HttpResponse.json([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "تهران",
        label: "تهران",
      },
    ]),
  ),
  http.get("*/api/v1/catalog/statistics/", () =>
    HttpResponse.json({
      searchable_property_count: 12,
      active_listing_count: 18,
      covered_neighborhood_count: 5,
    }),
  ),
  http.get("*/api/v1/catalog/properties/", () =>
    HttpResponse.json(propertySearchPage),
  ),
  http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
  http.post(
    "*/api/v1/catalog/properties/:propertyId/view/",
    () => new HttpResponse(null, { status: 204 }),
  ),
);
