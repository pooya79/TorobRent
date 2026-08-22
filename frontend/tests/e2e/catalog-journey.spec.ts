import { expect, test } from "@playwright/test";

const externalEnvironment = Boolean(process.env.E2E_BASE_URL);
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const operatorPassword =
  process.env.E2E_OPERATOR_PASSWORD ?? "operator-password";

test("Operator publishes a curated Property that a Renter opens through SSR", async ({
  page,
  request,
}) => {
  test.skip(
    externalEnvironment && !process.env.E2E_OPERATOR_EMAIL,
    "External stacks must provide an E2E Operator and the catalog fixture",
  );

  await page.goto("/admin/login/");
  await page.getByLabel(/email/i).fill(operatorEmail);
  await page.getByLabel(/password/i).fill(operatorPassword);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/admin\/$/);

  await page.goto("/admin/catalog/rentalterms/add/");
  await page.locator("#id_deposit_toman").fill("۱٬۰۰۰٬۰۰۰٬۰۰۰");
  await page.locator("#id_monthly_rent_toman").fill("۲۵٬۰۰۰٬۰۰۰");
  await page.locator('input[name="_continue"]').click();
  await expect(page).toHaveURL(/\/admin\/catalog\/rentalterms\/.+\/change\/$/);
  const termsId = page.url().match(/rentalterms\/([^/]+)\/change/)?.[1];
  expect(termsId).toBeTruthy();

  await page.goto("/admin/catalog/property/add/");
  await page.locator("#id_city").selectOption({ label: "تهران" });
  await page.locator("#id_district").selectOption({ label: "منطقه ۲" });
  await page.locator("#id_neighborhood").selectOption({ label: "سعادت‌آباد" });
  await page.locator("#id_property_type").selectOption("apartment");
  await page.locator("#id_area_sqm").fill("110");
  await page.locator("#id_room_count").fill("2");
  await page.locator("#id_parking").selectOption("present");
  await page.locator('input[name="_continue"]').click();
  await expect(page).toHaveURL(/\/admin\/catalog\/property\/.+\/change\/$/);
  const propertyId = page.url().match(/property\/([^/]+)\/change/)?.[1];
  expect(propertyId).toBeTruthy();

  await page.goto("/admin/catalog/listing/add/");
  await page.locator("#id_property").selectOption(propertyId!);
  await page
    .locator("#id_source")
    .selectOption({ label: "منبع مستقیم ترب‌رنت" });
  await page.locator("#id_terms").selectOption(termsId!);
  await page.locator("#id_description").fill("آپارتمان روشن و آرام");
  await page.locator("#id_direct_phone").fill("۰۹۱۲۱۲۳۴۵۶۷");
  await page.locator('input[name="_save"]').click();
  await expect(page).toHaveURL(/\/admin\/catalog\/listing\/$/);

  const listingRow = page.getByRole("row", {
    name: /منبع مستقیم ترب‌رنت: آپارتمان در سعادت‌آباد/,
  });
  await listingRow.locator('input[name="_selected_action"]').check();
  await page.locator('select[name="action"]').selectOption("publish_listings");
  await page.locator('button[name="index"]').click();
  await expect(page.getByText("یک آگهی منتشر شد.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible();
  const locationInput = page.getByRole("combobox", { name: "شهر یا محله" });
  await locationInput.pressSequentially("سعادت اباد");
  await page
    .getByRole("option", { name: "سعادت‌آباد، منطقه ۲، تهران" })
    .click();
  await page.getByRole("button", { name: "جست‌وجوی خانه" }).click();
  await expect(page).toHaveURL(/\/search\?location=/);
  await expect(
    page.getByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  await expect(page.getByText("۱ آگهی فعال")).toBeVisible();
  await expect(page.getByText("ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  await expect(page.getByText("اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان")).toBeVisible();

  const unfilteredResultsUrl = page.url();
  const desktopFilters = page.getByRole("complementary", {
    name: "فیلترهای جست‌وجو",
  });
  await expect(desktopFilters).toBeVisible();
  await desktopFilters.getByLabel("پارکینگ").selectOption("present");
  await desktopFilters.getByRole("button", { name: "اعمال فیلترها" }).click();
  await expect(page).toHaveURL(/parking=present/);
  const filteredResultsUrl = page.url();
  await page.getByRole("link", { name: "آپارتمان در سعادت‌آباد" }).click();
  await expect(
    page.getByRole("link", { name: "بازگشت به نتایج" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "بازگشت به نتایج" }).click();
  await expect(page).toHaveURL(filteredResultsUrl);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "حذف فیلتر پارکینگ" }),
  ).toBeVisible();
  await expect(desktopFilters.getByLabel("پارکینگ")).toHaveValue("present");

  await desktopFilters.getByLabel("حداکثر متراژ").fill("۱۰۰");
  await desktopFilters.getByRole("button", { name: "اعمال فیلترها" }).click();
  await expect(page).toHaveURL(/area_max=100/);
  await expect(
    page.getByRole("heading", { name: "ملکی در این محدوده پیدا نشد" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(unfilteredResultsUrl);
  await expect(desktopFilters).toBeHidden();
  await page.getByRole("button", { name: "فیلترها" }).click();
  const mobileFilters = page.getByRole("dialog");
  await mobileFilters.getByLabel("حداکثر متراژ").fill("100");
  await mobileFilters.getByRole("button", { name: "اعمال فیلترها" }).click();
  await expect(page).toHaveURL(/area_max=100/);
  await expect(
    page.getByRole("heading", { name: "ملکی در این محدوده پیدا نشد" }),
  ).toBeVisible();

  await page.goto(`/properties/${propertyId}/نشانی-قدیمی`);
  await expect(page).toHaveURL(new RegExp(`/properties/${propertyId}/.+`));
  await expect(
    page.getByRole("heading", { name: "آپارتمان در سعادت‌آباد", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  await expect(
    page.getByText("تصویر مجازی برای این ملک منتشر نشده است"),
  ).toBeVisible();

  const response = await request.get(page.url());
  const html = await response.text();
  expect(response.ok()).toBe(true);
  expect(html).toContain("آپارتمان در سعادت‌آباد");
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('property="og:title"');
});
