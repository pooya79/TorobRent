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

test("compares every active Listing and makes source disagreements visible", () => {
  render(<PropertyDetailPage property={property} />);

  const direct = screen.getByRole("article", {
    name: "آگهی منبع مستقیم ترب‌رنت",
  });
  const external = screen.getByRole("article", { name: "آگهی منبع نمونه" });
  expect(direct).toHaveTextContent("۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
  expect(external).toHaveTextContent("۸۰۰٬۰۰۰٬۰۰۰ تومان");
  expect(external).toHaveTextContent("اختلاف با مشخصات تأییدشده");
  expect(external).toHaveTextContent("متراژ: منبع ۱۰۸، تأییدشده ۱۱۰");
  expect(external).toHaveTextContent("پارکینگ: منبع ندارد، تأییدشده دارد");
  expect(external.getElementsByTagName("img")).toHaveLength(1);
  expect(external.getElementsByTagName("img")[0]).toHaveAttribute(
    "src",
    "https://cdn.example-source.test/listings/42.jpg",
  );
  expect(external.innerHTML).not.toContain("third-party.example/hotlink.jpg");
  expect(
    screen.getByRole("link", { name: "ادامه در منبع اصلی" }),
  ).toHaveAttribute("href", "https://example-source.test/listings/42");
});
