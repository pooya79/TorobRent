import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";

import { loader, meta } from "@/routes/property-detail";
import { server } from "./server";
import { propertyDetail } from "./fixtures/catalog";

function loaderArgs(slug: string, search = "") {
  return {
    request: new Request(
      `http://localhost/properties/${propertyDetail.id}/${slug}${search}`,
    ),
    params: { propertyId: propertyDetail.id, slug },
    context: {},
  } as Parameters<typeof loader>[0];
}

test("loads the published Property through the generated API contract", async () => {
  server.use(
    http.get(
      `http://localhost/api/v1/catalog/properties/${propertyDetail.id}/`,
      () => HttpResponse.json(propertyDetail),
    ),
  );

  await expect(
    loader(loaderArgs(propertyDetail.canonical_slug)),
  ).resolves.toMatchObject({ property: propertyDetail });
});

test("permanently redirects a stale Persian slug to the canonical URL", async () => {
  server.use(
    http.get(
      `http://localhost/api/v1/catalog/properties/${propertyDetail.id}/`,
      () => HttpResponse.json(propertyDetail),
    ),
  );

  let response: Response | undefined;
  try {
    await loader(
      loaderArgs("نشانی-قدیمی", "?returnTo=%2Fsearch%3Fparking%3Dpresent"),
    );
  } catch (error) {
    if (error instanceof Response) response = error;
  }

  expect(response).toBeInstanceOf(Response);
  expect(response?.status).toBe(301);
  expect(decodeURI(response?.headers.get("Location") ?? "")).toBe(
    `/properties/${propertyDetail.id}/${propertyDetail.canonical_slug}?returnTo=%2Fsearch%3Fparking%3Dpresent`,
  );
});

test("publishes canonical and social metadata from server-loaded facts", () => {
  const metadata = meta({ loaderData: { property: propertyDetail } });

  expect(metadata).toContainEqual({
    title: "آپارتمان در سعادت‌آباد | ترب‌رنت",
  });
  expect(metadata).toContainEqual({
    tagName: "link",
    rel: "canonical",
    href: `/properties/${propertyDetail.id}/${propertyDetail.canonical_slug}`,
  });
  expect(metadata).toContainEqual({
    property: "og:title",
    content: "آپارتمان در سعادت‌آباد | ترب‌رنت",
  });
});
