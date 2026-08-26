import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { PropertyDetailPage } from "@/pages/PropertyDetailPage";
import {
  officePropertyDetail,
  propertyDetail as property,
} from "./fixtures/catalog";
import { server } from "./server";

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

test("uses commercial room wording and omits the fact when an Office has no room count", () => {
  const { rerender } = render(
    <PropertyDetailPage
      property={{ ...officePropertyDetail, room_count: 3 }}
    />,
  );

  expect(screen.getByText("۳ اتاق")).toBeVisible();
  expect(screen.queryByText(/خواب/)).not.toBeInTheDocument();

  rerender(<PropertyDetailPage property={officePropertyDetail} />);
  expect(screen.queryByText("۳ اتاق")).not.toBeInTheDocument();
  expect(screen.queryByText(/خواب/)).not.toBeInTheDocument();
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
    screen.getByRole("button", { name: "ادامه در منبع اصلی" }),
  ).toBeVisible();
});

test("keeps the approved phone out of initial indexable content and reveals it explicitly", async () => {
  let eventSession: string | null = null;
  server.use(
    http.post(
      `*/api/v1/catalog/listings/${property.listings[0]!.id}/phone-reveal/`,
      ({ request }) => {
        eventSession = request.headers.get("X-TorobRent-Event-Session");
        return HttpResponse.json({ phone: "۰۹۱۲۱۲۳۴۵۶۷" });
      },
    ),
  );
  const initialDocument = renderToString(
    <PropertyDetailPage property={property} />,
  );
  expect(initialDocument).not.toContain("۰۹۱۲۱۲۳۴۵۶۷");
  expect(initialDocument).toContain("نمایش شماره تماس");

  render(<PropertyDetailPage property={property} />);
  await userEvent.click(
    screen.getByRole("button", { name: "نمایش شماره تماس" }),
  );

  expect(
    await screen.findByRole("link", { name: "تماس با ۰۹۱۲۱۲۳۴۵۶۷" }),
  ).toHaveAttribute("href", "tel:۰۹۱۲۱۲۳۴۵۶۷");
  expect(eventSession).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("records a Property view and resolves external continuation through the API", async () => {
  const navigate = vi.fn();
  let viewCount = 0;
  server.use(
    http.post(
      `*/api/v1/catalog/properties/${property.id}/view/`,
      ({ request }) => {
        expect(request.headers.get("X-TorobRent-Event-Session")).toBeTruthy();
        viewCount += 1;
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.post(
      `*/api/v1/catalog/listings/${property.listings[1]!.id}/continuation/`,
      () =>
        HttpResponse.json({
          url: "https://example-source.test/listings/42",
        }),
    ),
  );

  render(
    <PropertyDetailPage property={property} onNavigateExternal={navigate} />,
  );
  await waitFor(() => expect(viewCount).toBe(1));
  await userEvent.click(
    screen.getByRole("button", { name: "ادامه در منبع اصلی" }),
  );

  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      "https://example-source.test/listings/42",
    ),
  );
});
