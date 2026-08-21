import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ResultsPage } from "@/pages/ResultsPage";

test("presents each Property with its freshest Rental Terms and Listing count", () => {
  render(
    <MemoryRouter>
      <ResultsPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "خانه‌های اجاره‌ای در تهران" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "آپارتمان روشن در سعادت‌آباد" }),
  ).toBeVisible();
  expect(screen.getByText("۳ آگهی فعال")).toBeVisible();
  expect(screen.getByText("ودیعه ۱ میلیارد تومان")).toBeVisible();
  expect(screen.getByText("اجاره ماهانه ۲۵ میلیون تومان")).toBeVisible();
});

test("explains when no Property matches the selected filters", () => {
  render(
    <MemoryRouter initialEntries={["/search?prototypeState=empty"]}>
      <ResultsPage />
    </MemoryRouter>,
  );

  expect(
    screen.getByRole("heading", { name: "ملکی با این فیلترها پیدا نشد" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "پاک کردن فیلترها" })).toBeVisible();
});

test("keeps applied filters and pagination shareable in the URL", () => {
  render(
    <MemoryRouter
      initialEntries={["/search?location=تهران&property_type=apartment&page=2"]}
    >
      <ResultsPage />
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: "تهران ×" })).toHaveAttribute(
    "href",
    "/search?property_type=apartment&page=2",
  );
  expect(screen.getByRole("link", { name: "۲" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("filters with complete Rental Terms and offers a working error recovery", () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/search"]}>
      <ResultsPage />
    </MemoryRouter>,
  );

  expect(screen.getAllByLabelText("حداقل ودیعه")).not.toHaveLength(0);
  expect(screen.getAllByLabelText("حداقل اجاره ماهانه")).not.toHaveLength(0);

  unmount();
  render(
    <MemoryRouter
      initialEntries={["/search?prototypeState=error&location=تهران"]}
    >
      <ResultsPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "تلاش دوباره" })).toHaveAttribute(
    "href",
    "/search?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86",
  );
});
