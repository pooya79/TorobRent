import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("shows only Listings belonging to the routed Property", () => {
  render(
    <MemoryRouter initialEntries={["/properties/tehran-pars-12"]}>
      <Routes>
        <Route
          path="/properties/:propertyId"
          element={<PropertyDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

  const listing = screen.getByRole("row", { name: /منبع مستقیم/ });
  expect(listing).toHaveTextContent("۷۰۰ میلیون تومان");
  expect(listing).toHaveTextContent("۱۸ میلیون تومان");
  expect(
    screen.queryByRole("heading", { name: "اختلاف در مبلغ ودیعه" }),
  ).not.toBeInTheDocument();
});

test("reveals the prototype contact only after the Renter asks", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <PropertyDetailPage />
    </MemoryRouter>,
  );

  expect(screen.queryByText("۰۹۱۲ ۱۲۳ ۴۵۶۷")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "مشاهده راه ارتباطی" }));
  expect(screen.getByText("۰۹۱۲ ۱۲۳ ۴۵۶۷")).toBeVisible();
});
