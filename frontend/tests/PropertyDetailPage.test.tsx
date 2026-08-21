import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";

import { PropertyDetailPage } from "@/pages/PropertyDetailPage";

test("keeps source Listings and their disagreements visible", () => {
  render(
    <MemoryRouter>
      <PropertyDetailPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "آپارتمان روشن در سعادت‌آباد" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "مقایسه ۳ آگهی فعال" }),
  ).toBeVisible();
  expect(screen.getByText("اختلاف در مبلغ ودیعه")).toBeVisible();
  for (const source of ["منبع مستقیم", "ملک‌رادار", "خانه‌نما"]) {
    expect(screen.getByRole("row", { name: new RegExp(source) })).toBeVisible();
  }
});

test("loads Property facts from the routed prototype fixture", () => {
  render(
    <MemoryRouter initialEntries={["/properties/yousef-abad-204"]}>
      <Routes>
        <Route
          path="/properties/:propertyId"
          element={<PropertyDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "خانه آرام نزدیک پارک شفق" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "مقایسه ۲ آگهی فعال" }),
  ).toBeVisible();
});
