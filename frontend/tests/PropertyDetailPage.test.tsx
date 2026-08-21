import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PropertyDetailPage } from "@/pages/PropertyDetailPage";
import { propertyDetail as property } from "./fixtures/catalog";

test("shows normalized facts, paired toman terms, and freshness", () => {
  render(<PropertyDetailPage property={property} />);

  expect(
    screen.getByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  expect(screen.getByText("تهران، منطقه ۲، سعادت‌آباد")).toBeVisible();
  expect(screen.getByText("۱۱۰ متر")).toBeVisible();
  expect(screen.getByText("۲ خواب")).toBeVisible();
  expect(screen.getByText("سال ساخت ۱٬۴۰۰")).toBeVisible();
  expect(screen.getByText("۶ طبقه")).toBeVisible();
  expect(screen.getByText("۲ واحد در هر طبقه")).toBeVisible();
  expect(screen.getByText("گرمایش: پکیج")).toBeVisible();
  expect(screen.getByText("سرمایش: کولر آبی")).toBeVisible();
  const listing = screen.getByRole("article", {
    name: "آگهی منبع مستقیم ترب‌رنت",
  });
  expect(listing).toHaveTextContent("۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
  expect(listing).toHaveTextContent("۲۵٬۰۰۰٬۰۰۰ تومان");
  expect(listing).toHaveTextContent("آخرین تأیید موجودی");
});

test("keeps unknown features distinct and shows the neutral media placeholder", () => {
  render(<PropertyDetailPage property={property} />);

  expect(
    screen.getByText("تصویر مجازی برای این ملک منتشر نشده است"),
  ).toBeVisible();
  expect(screen.getByText("آسانسور: نامشخص")).toBeVisible();
  expect(screen.getByText("انباری: ندارد")).toBeVisible();
  expect(screen.getByText("پارکینگ: دارد")).toBeVisible();
});
