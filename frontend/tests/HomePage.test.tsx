import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { HomePage } from "@/pages/HomePage";
import { api } from "@/lib/api/client";

test("renders anonymous ready state", async () => {
  const health = await api.GET("/api/v1/system/ready/");
  expect(health.data).toEqual({ status: "ok" });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(screen.getByRole("heading", { name: /TorobRent/i })).toBeVisible();
  expect(await screen.findByText("Ready")).toBeVisible();
  expect(await screen.findByText("Anonymous")).toBeVisible();
});
