import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const server = setupServer(
  http.get("*/api/v1/auth/session/", () =>
    HttpResponse.json({ authenticated: false, csrf_token: "test-token" }),
  ),
  http.get("*/api/v1/system/ready/", () => HttpResponse.json({ status: "ok" })),
);
