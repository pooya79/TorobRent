import { render, screen, waitFor, within } from "@testing-library/react";
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

test.each([
  ["office", "دفتر اداری"],
  ["shop", "مغازه"],
  ["warehouse", "انبار"],
  ["workshop", "کارگاه"],
] as const)(
  "uses commercial room wording and omission for %s",
  (propertyType, label) => {
    const commercialProperty = {
      ...officePropertyDetail,
      title: `${label} در سعادت‌آباد`,
      property_type: propertyType,
      property_type_label: label,
    };
    const { rerender } = render(
      <PropertyDetailPage
        property={{ ...commercialProperty, room_count: 3 }}
      />,
    );

    expect(screen.getByText("۳ اتاق")).toBeVisible();
    expect(screen.queryByText(/خواب/)).not.toBeInTheDocument();

    rerender(<PropertyDetailPage property={commercialProperty} />);
    expect(screen.queryByText("۳ اتاق")).not.toBeInTheDocument();
    expect(screen.queryByText(/خواب/)).not.toBeInTheDocument();
  },
);

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
    "/api/v1/catalog/media/image-42/",
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
  expect(initialDocument).toContain(
    "شماره نمایش‌داده‌شده را نمی‌توان از کسی که آن را دیده پس گرفت",
  );

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

test("requires account access before revealing a phone number", async () => {
  let resume: (() => void) | undefined;
  let revealCount = 0;
  server.use(
    http.post(
      `*/api/v1/catalog/listings/${property.listings[0]!.id}/phone-reveal/`,
      () => {
        revealCount += 1;
        return HttpResponse.json({ phone: "۰۹۱۲۱۲۳۴۵۶۷" });
      },
    ),
  );
  render(
    <PropertyDetailPage
      property={property}
      onRequestAccess={(intent) => {
        resume = intent;
      }}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "نمایش شماره تماس" }),
  );
  expect(revealCount).toBe(0);
  expect(resume).toBeTypeOf("function");

  resume?.();
  expect(
    await screen.findByRole("link", { name: "تماس با ۰۹۱۲۱۲۳۴۵۶۷" }),
  ).toBeVisible();
  expect(revealCount).toBe(1);
});

test("explains a global Account Block without offering either contact path", () => {
  render(
    <PropertyDetailPage
      property={{
        ...property,
        listings: property.listings.map((listing, index) =>
          index === 0
            ? {
                ...listing,
                can_message_submitter: false,
                contact_blocked: true,
              }
            : listing,
        ),
      }}
      account={{ authenticated: true, displayName: "رها", verified: true }}
    />,
  );

  const direct = screen.getByRole("article", {
    name: "آگهی منبع مستقیم ترب‌رنت",
  });
  expect(direct).toHaveTextContent(
    "ارتباط میان شما و این ثبت‌کننده مسدود شده است",
  );
  expect(
    within(direct).queryByRole("button", { name: "پیام به ثبت‌کننده" }),
  ).not.toBeInTheDocument();
  expect(
    within(direct).queryByRole("button", { name: "نمایش شماره تماس" }),
  ).not.toBeInTheDocument();
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

test("offers Listing Inquiry only for an eligible internal Listing and identifies the owner", () => {
  const { rerender } = render(
    <PropertyDetailPage
      property={property}
      account={{ authenticated: true, displayName: "رها", verified: true }}
    />,
  );

  const direct = screen.getByRole("article", {
    name: "آگهی منبع مستقیم ترب‌رنت",
  });
  const external = screen.getByRole("article", { name: "آگهی منبع نمونه" });
  expect(
    within(direct).getByRole("button", { name: "پیام به ثبت‌کننده" }),
  ).toBeVisible();
  expect(
    within(direct).getByRole("button", { name: "نمایش شماره تماس" }),
  ).toBeVisible();
  expect(
    within(external).queryByRole("button", { name: "پیام به ثبت‌کننده" }),
  ).not.toBeInTheDocument();

  rerender(
    <PropertyDetailPage
      property={{
        ...property,
        listings: property.listings.map((listing, index) =>
          index === 0
            ? {
                ...listing,
                can_message_submitter: false,
                is_responsible_submitter: true,
              }
            : listing,
        ),
      }}
      account={{ authenticated: true, displayName: "مالک", verified: true }}
    />,
  );

  expect(screen.getByText("این آگهی شماست")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "پیام به ثبت‌کننده" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "نمایش شماره تماس" }),
  ).not.toBeInTheDocument();
});

test("explains when an internal Listing has no revealable approved phone", () => {
  render(
    <PropertyDetailPage
      property={{
        ...property,
        listings: property.listings.map((listing, index) =>
          index === 0
            ? {
                ...listing,
                can_reveal_phone: false,
                phone_reveal_unavailable_reason: "phone_unavailable",
              }
            : listing,
        ),
      }}
      account={{ authenticated: true, displayName: "رها", verified: true }}
    />,
  );

  const direct = screen.getByRole("article", {
    name: "آگهی منبع مستقیم ترب‌رنت",
  });
  expect(direct).toHaveTextContent(
    "شماره تماس تأییدشده این آگهی در دسترس نیست",
  );
  expect(
    within(direct).queryByRole("button", { name: "نمایش شماره تماس" }),
  ).not.toBeInTheDocument();
});

test("restores the exact Listing composer after account access", async () => {
  let resume: (() => void) | undefined;
  render(
    <PropertyDetailPage
      property={property}
      onRequestAccess={(intent) => {
        resume = intent;
      }}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "پیام به ثبت‌کننده" }),
  );
  expect(resume).toBeTypeOf("function");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  resume?.();
  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "منبع مستقیم ترب‌رنت",
  );
});

test("restores the selected Listing composer after verification reload", async () => {
  sessionStorage.setItem("listing-inquiry-intent", property.listings[0]!.id);

  render(
    <PropertyDetailPage
      property={property}
      account={{ authenticated: true, displayName: "رها", verified: true }}
    />,
  );

  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "منبع مستقیم ترب‌رنت",
  );
  expect(sessionStorage.getItem("listing-inquiry-intent")).toBeNull();
});

test("chooses an explicitly unverified Display Name and opens the sent inquiry", async () => {
  const navigate = vi.fn();
  server.use(
    http.put("*/api/v1/users/me/display-name/", async ({ request }) => {
      expect(await request.json()).toEqual({ display_name: "رها" });
      return HttpResponse.json({
        display_name: "رها",
        identity_verified: false,
      });
    }),
    http.post("*/api/v1/messages/listing-inquiries/", async ({ request }) => {
      expect(await request.json()).toEqual({
        listing_id: property.listings[0]!.id,
        body: "برای بازدید چه زمانی مناسب است؟",
      });
      return HttpResponse.json(
        {
          id: "5ad03176-83d3-4f6a-a448-349d21b51f85",
          href: "/messages/thread",
        },
        { status: 201 },
      );
    }),
  );
  render(
    <PropertyDetailPage
      property={property}
      account={{ authenticated: true, displayName: "", verified: true }}
      onNavigateMessage={navigate}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", { name: "پیام به ثبت‌کننده" }),
  );
  expect(screen.getByText(/هویت قانونی شما را تأیید نمی‌کند/)).toBeVisible();
  expect(screen.getByText(/شماره تماس و پیوند مجاز است/)).toBeVisible();
  await userEvent.type(screen.getByLabelText("نام نمایشی"), "رها");
  await userEvent.type(
    screen.getByLabelText("پیام نخست"),
    "برای بازدید چه زمانی مناسب است؟",
  );
  await userEvent.click(screen.getByRole("button", { name: "ارسال پیام" }));

  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/messages/thread"),
  );
});
