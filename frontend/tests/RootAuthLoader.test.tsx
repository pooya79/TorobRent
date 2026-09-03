import { hydrate, QueryClient } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import { ProductShell } from "@/app/ProductShell";
import { loader } from "@/root";
import { server } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("hydrates an authenticated account into the initial server render", async () => {
  const currentUser = {
    id: "10000000-0000-4000-8000-000000000001",
    email: "renter@example.com",
    first_name: "پویا",
    last_name: "اجاره‌جو",
    email_verified: true,
    operator_capabilities: [],
  };

  server.use(
    http.get("http://backend.test/api/v1/auth/session/", ({ request }) => {
      expect(request.headers.get("cookie")).toBe("sessionid=authenticated");
      return HttpResponse.json(
        { authenticated: true, csrf_token: "server-token" },
        {
          headers: {
            "Set-Cookie": "csrftoken=server-cookie; Path=/; SameSite=Lax",
          },
        },
      );
    }),
    http.get("http://backend.test/api/v1/users/me/", ({ request }) => {
      expect(request.headers.get("cookie")).toContain(
        "sessionid=authenticated",
      );
      return HttpResponse.json(currentUser);
    }),
  );

  vi.stubGlobal("window", undefined);
  vi.stubEnv("VITE_PROXY_TARGET", "http://backend.test");

  const result = await loader({
    request: new Request("http://frontend.test/", {
      headers: { cookie: "sessionid=authenticated" },
    }),
    params: {},
    context: {},
  } as Parameters<typeof loader>[0]);
  const queryClient = new QueryClient();
  hydrate(queryClient, result.data.dehydratedState);

  expect(queryClient.getQueryData(["session"])).toMatchObject({
    authenticated: true,
  });
  expect(queryClient.getQueryData(["current-user"])).toEqual(currentUser);
  expect(new Headers(result.init?.headers).get("set-cookie")).toContain(
    "csrftoken=server-cookie",
  );
  expect(new Headers(result.init?.headers).get("cache-control")).toBe(
    "private, no-store",
  );

  vi.unstubAllGlobals();
  render(
    <MemoryRouter>
      <AppProviders
        csrfToken={result.data.csrfToken}
        dehydratedState={result.data.dehydratedState}
      >
        <ProductShell>
          <main />
        </ProductShell>
      </AppProviders>
    </MemoryRouter>,
  );

  const navbar = screen.getByRole("banner", { name: "راهبری عمومی" });
  expect(
    within(navbar).getByRole("button", { name: "حساب کاربری" }),
  ).toBeVisible();
  expect(within(navbar).queryByRole("link", { name: "ورود" })).toBeNull();
});
