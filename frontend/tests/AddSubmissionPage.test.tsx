import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { AddSubmissionPage } from "@/pages/AddSubmissionPage";
import { server } from "./server";

const draft = {
  id: "10000000-0000-4000-8000-000000000010",
  role: "owner",
  state: "draft",
  current_step: "location",
  media_complete: false,
  images: [],
  location: null,
  property_facts: null,
  rental_terms: null,
  features: {
    parking: "unknown",
    elevator: "unknown",
    storage: "unknown",
    balcony: "unknown",
    furnished: "unknown",
  },
  description: "",
  contact: null,
  review: {},
  created_at: "2026-08-22T08:00:00Z",
  updated_at: "2026-08-22T08:00:00Z",
};

function renderPage(entry = "/add-submission") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AddSubmissionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("creates an Owner draft and presents the seven server-backed steps", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/submissions/", () =>
      HttpResponse.json(draft, { status: 201 }),
    ),
    http.get("*/api/v1/submissions/:id/", () => HttpResponse.json(draft)),
  );
  renderPage();

  await user.click(
    screen.getByRole("button", { name: "ساخت پیش‌نویس و ادامه" }),
  );

  expect(await screen.findByText(/مرحله ۱ از ۷/)).toBeVisible();
  for (const step of [
    "نشانی ملک",
    "مشخصات ملک",
    "شرایط اجاره",
    "امکانات و توضیحات",
    "تصاویر",
    "اطلاعات تماس",
    "بازبینی",
  ]) {
    expect(screen.getAllByText(step).length).toBeGreaterThan(0);
  }
});

test("attaches localized validation to the relevant field and preserves valid input", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  const area = await screen.findByLabelText("متراژ");
  await user.type(area, "۰");
  await user.type(screen.getByLabelText("تعداد اتاق خواب"), "۲");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "متراژ باید بیشتر از صفر باشد.",
  );
  expect(area).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("تعداد اتاق خواب")).toHaveValue("۲");
});

test("accepts an Office without room count and uses commercial wording", async () => {
  const user = userEvent.setup();
  let savedBody: unknown;
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
    http.patch("*/api/v1/submissions/:id/", async ({ request }) => {
      savedBody = await request.json();
      return HttpResponse.json({
        ...draft,
        current_step: "rental_terms",
        property_facts: {
          property_category: "commercial",
          property_category_label: "تجاری",
          property_type: "office",
          area_sqm: 95,
          room_count: null,
        },
      });
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  await user.selectOptions(await screen.findByLabelText("نوع ملک"), "office");
  expect(
    screen.getByLabelText("تعداد اتاق یا پارتیشن (اختیاری)"),
  ).toBeVisible();
  await user.type(screen.getByLabelText("متراژ"), "۹۵");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  await waitFor(() =>
    expect(savedBody).toMatchObject({
      completed_step: "property_facts",
      property_facts: {
        property_type: "office",
        area_sqm: 95,
        room_count: null,
      },
    }),
  );
});

test("presents all seven Property Types under their canonical categories", async () => {
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  await screen.findByLabelText("نوع ملک");
  for (const label of ["آپارتمان", "خانه", "ویلا"]) {
    expect(
      screen.getByRole("option", { name: label }).parentElement,
    ).toHaveAttribute("label", "مسکونی");
  }
  for (const label of ["دفتر اداری", "مغازه", "انبار", "کارگاه"]) {
    expect(
      screen.getByRole("option", { name: label }).parentElement,
    ).toHaveAttribute("label", "تجاری");
  }
});

test("normalizes Persian Toman input before saving and resumes at the next step", async () => {
  const user = userEvent.setup();
  let savedBody: unknown;
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "rental_terms" }),
    ),
    http.patch("*/api/v1/submissions/:id/", async ({ request }) => {
      savedBody = await request.json();
      return HttpResponse.json({
        ...draft,
        current_step: "features_description",
      });
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=rental_terms`);

  await user.type(
    await screen.findByLabelText("ودیعه، تومان"),
    "۱٬۰۰۰٬۰۰۰٬۰۰۰",
  );
  await user.type(screen.getByLabelText("اجاره ماهانه، تومان"), "۲۵٬۰۰۰٬۰۰۰");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  await waitFor(() =>
    expect(savedBody).toMatchObject({
      completed_step: "rental_terms",
      rental_terms: {
        deposit_toman: 1_000_000_000,
        monthly_rent_toman: 25_000_000,
      },
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "امکانات و توضیحات" }),
  ).toBeVisible();
});

test("attaches server validation to the field that failed", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "property_facts" }),
    ),
    http.patch("*/api/v1/submissions/:id/", () =>
      HttpResponse.json(
        {
          detail: "تعداد اتاق نامعتبر است.",
          errors: {
            "property_facts.room_count": [
              {
                code: "min_value",
                message: "تعداد اتاق نمی‌تواند منفی باشد.",
              },
            ],
          },
        },
        { status: 400 },
      ),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=property_facts`);

  await user.type(await screen.findByLabelText("متراژ"), "۱۱۰");
  await user.type(screen.getByLabelText("تعداد اتاق خواب"), "-۱");
  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));

  expect(
    (await screen.findAllByText("تعداد اتاق نمی‌تواند منفی باشد."))[0],
  ).toBeVisible();
  expect(screen.getByLabelText("تعداد اتاق خواب")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("متراژ")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
});

test("hydrates persisted final review data when a draft is resumed", async () => {
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({
        ...draft,
        current_step: "review",
        review: { accuracy_confirmed: true },
      }),
    ),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=review`);

  expect(
    await screen.findByLabelText(
      "اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.",
    ),
  ).toBeChecked();
});

test("saves final review and submits the revision to the Operator queue", async () => {
  const user = userEvent.setup();
  let submitted = false;
  const reviewDraft = {
    ...draft,
    current_step: "review",
    media_complete: true,
    review: {},
  };
  server.use(
    http.get("*/api/v1/submissions/:id/", () => HttpResponse.json(reviewDraft)),
    http.patch("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({
        ...reviewDraft,
        review: { accuracy_confirmed: true },
      }),
    ),
    http.post("*/api/v1/submissions/:id/submit/", () => {
      submitted = true;
      return HttpResponse.json({ ...reviewDraft, state: "pending" });
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=review`);

  await user.click(
    await screen.findByLabelText(
      "اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.",
    ),
  );
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));

  await waitFor(() => expect(submitted).toBe(true));
  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
});

test("uploads, previews, reorders, selects primary, removes, and completes the media step", async () => {
  const user = userEvent.setup();
  const mediaImage = (id: string, position: number, isPrimary: boolean) => ({
    id,
    status: "ready" as const,
    failure_reason: "",
    position,
    is_primary: isPrimary,
    variants: [
      {
        kind: "medium" as const,
        url: `/api/media/${id}.webp`,
        width: 640,
        height: 480,
        byte_size: 1200,
      },
    ],
    created_at: "2026-08-22T08:00:00Z",
    updated_at: "2026-08-22T08:00:00Z",
  });
  let images: ReturnType<typeof mediaImage>[] = [];
  let completed = false;
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({
        ...draft,
        current_step: completed ? "contact" : "images",
        media_complete: completed,
        images,
      }),
    ),
    http.post("*/api/v1/submissions/:id/images/", () => {
      const id = `10000000-0000-4000-8000-${String(images.length + 20).padStart(12, "0")}`;
      images.push(mediaImage(id, images.length, images.length === 0));
      return HttpResponse.json(images.at(-1), { status: 201 });
    }),
    http.patch("*/api/v1/submissions/:id/images/", async ({ request }) => {
      const body = (await request.json()) as {
        image_ids: string[];
        primary_image_id: string;
      };
      images = body.image_ids.map((id, position) => ({
        ...images.find((image) => image.id === id)!,
        position,
        is_primary: id === body.primary_image_id,
      }));
      return HttpResponse.json(images);
    }),
    http.delete("*/api/v1/submissions/:id/images/:imageId/", ({ params }) => {
      images = images
        .filter((image) => image.id !== params.imageId)
        .map((image, position) => ({
          ...image,
          position,
          is_primary: position === 0,
        }));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("*/api/v1/submissions/:id/", async ({ request }) => {
      expect(await request.json()).toEqual({ completed_step: "images" });
      completed = true;
      return HttpResponse.json({
        ...draft,
        current_step: "contact",
        media_complete: true,
        images,
      });
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=images`);

  const upload = await screen.findByLabelText("افزودن تصاویر");
  await user.upload(upload, [
    new File(["one"], "one.jpg", { type: "image/jpeg" }),
    new File(["two"], "two.webp", { type: "image/webp" }),
  ]);

  expect(
    await screen.findAllByRole("img", { name: "پیش‌نمایش تصویر" }),
  ).toHaveLength(2);
  await user.click(
    screen.getAllByRole("radio", { name: "انتخاب به‌عنوان تصویر اصلی" })[1]!,
  );
  await waitFor(() => expect(images[1]?.is_primary).toBe(true));
  await user.click(
    screen.getAllByRole("button", { name: "انتقال به ابتدا" })[1]!,
  );
  await waitFor(() => expect(images[0]?.is_primary).toBe(true));
  await user.click(screen.getAllByRole("button", { name: "حذف تصویر" })[1]!);
  expect(
    await screen.findAllByRole("img", { name: "پیش‌نمایش تصویر" }),
  ).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));
  expect(
    await screen.findByRole("heading", { name: "اطلاعات تماس" }),
  ).toBeVisible();
});

test("keeps successful uploads visible when a later file in the batch is rejected", async () => {
  const user = userEvent.setup();
  const storedImage = {
    id: "10000000-0000-4000-8000-000000000099",
    status: "ready" as const,
    failure_reason: "",
    position: 0,
    is_primary: true,
    variants: [
      {
        kind: "medium" as const,
        url: "/api/media/partial-success.webp",
        width: 640,
        height: 480,
        byte_size: 1200,
      },
    ],
    created_at: "2026-08-22T08:00:00Z",
    updated_at: "2026-08-22T08:00:00Z",
  };
  let uploadCount = 0;
  let images: (typeof storedImage)[] = [];
  server.use(
    http.get("*/api/v1/submissions/:id/", () =>
      HttpResponse.json({ ...draft, current_step: "images", images }),
    ),
    http.post("*/api/v1/submissions/:id/images/", () => {
      uploadCount += 1;
      if (uploadCount === 1) {
        images = [storedImage];
        return HttpResponse.json(storedImage, { status: 201 });
      }
      return HttpResponse.json(
        { detail: "فایل بارگذاری‌شده یک تصویر معتبر نیست." },
        { status: 400 },
      );
    }),
  );
  renderPage(`/add-submission?submission=${draft.id}&step=images`);

  await user.upload(await screen.findByLabelText("افزودن تصاویر"), [
    new File(["valid"], "valid.jpg", { type: "image/jpeg" }),
    new File(["invalid"], "invalid.jpg", { type: "image/jpeg" }),
  ]);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "فایل بارگذاری‌شده یک تصویر معتبر نیست.",
  );
  expect(
    await screen.findByRole("img", { name: "پیش‌نمایش تصویر" }),
  ).toBeVisible();
});
