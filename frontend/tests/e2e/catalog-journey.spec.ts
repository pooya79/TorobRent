import { expect, test } from "@playwright/test";

const externalEnvironment = Boolean(process.env.E2E_BASE_URL);
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const operatorPassword =
  process.env.E2E_OPERATOR_PASSWORD ?? "operator-password";

test("@milestone Operator publishes a curated Property that a Renter opens through SSR", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
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
  await page.getByRole("button", { name: "نمایش شماره تماس" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "مسیر ادامه این آگهی در دسترس نیست",
  );
  await expect(page.getByRole("link", { name: /تماس با/ })).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/catalog/source/add/");
  await page.locator("#id_name").fill("external-browser-source");
  await page.locator("#id_domain").fill("browser-source.example");
  await page.locator("#id_display_name").fill("منبع مرورگر");
  await page.locator("#id_outbound_policy").selectOption("external_link");
  await page.locator("#id_allows_external_media").check();
  await page.locator('input[name="_continue"]').click();
  const externalSourceId = page.url().match(/source\/([^/]+)\/change/)?.[1];
  expect(externalSourceId).toBeTruthy();

  await page.goto("/admin/catalog/rentalterms/add/");
  await page.locator("#id_deposit_toman").fill("۸۰۰٬۰۰۰٬۰۰۰");
  await page.locator("#id_monthly_rent_toman").fill("۳۰٬۰۰۰٬۰۰۰");
  await page.locator('input[name="_continue"]').click();
  const externalTermsId = page.url().match(/rentalterms\/([^/]+)\/change/)?.[1];
  expect(externalTermsId).toBeTruthy();

  await page.goto("/admin/catalog/property/add/");
  await page.locator("#id_city").selectOption({ label: "تهران" });
  await page.locator("#id_district").selectOption({ label: "منطقه ۲" });
  await page.locator("#id_neighborhood").selectOption({ label: "سعادت‌آباد" });
  await page.locator("#id_property_type").selectOption("apartment");
  await page.locator("#id_area_sqm").fill("108");
  await page.locator("#id_room_count").fill("2");
  await page.locator("#id_parking").selectOption("absent");
  await page.locator('input[name="_continue"]').click();
  const separatePropertyId = page.url().match(/property\/([^/]+)\/change/)?.[1];
  expect(separatePropertyId).toBeTruthy();

  await page.goto("/admin/catalog/listing/add/");
  await page.locator("#id_property").selectOption(separatePropertyId!);
  await page.locator("#id_source").selectOption(externalSourceId!);
  await page.locator("#id_terms").selectOption(externalTermsId!);
  await page.locator("#id_description").fill("ادعای منبع خارجی");
  await page.locator("#id_source_reference").fill("browser-42");
  await page
    .locator("#id_source_claims")
    .fill(
      '{"area_sqm": 108, "parking": "absent", "image_url": "https://third-party.example/hotlink.jpg"}',
    );
  await page
    .locator("#id_external_url")
    .fill("https://browser-source.example/listings/42");
  await page
    .locator("#id_external_media_url")
    .fill("https://browser-source.example/media/listings/42.jpg");
  await page.locator('input[name="_continue"]').click();
  const externalListingId = page.url().match(/listing\/([^/]+)\/change/)?.[1];
  expect(externalListingId).toBeTruthy();

  await page.goto("/admin/catalog/listing/");
  const externalListingRow = page.getByRole("row", {
    name: /منبع مرورگر: آپارتمان در سعادت‌آباد/,
  });
  await externalListingRow.locator('input[name="_selected_action"]').check();
  await page
    .locator('select[name="action"]')
    .first()
    .selectOption("publish_listings");
  await page.locator('button[name="index"]').click();
  await expect(page.getByText("یک آگهی منتشر شد.")).toBeVisible();

  await page.goto(`/admin/catalog/listing/${externalListingId}/change/`);
  await page.locator("#id_property").selectOption(propertyId!);
  await page.locator('input[name="_save"]').click();
  await page.goto(`/properties/${propertyId}/نشانی-قدیمی`);
  await expect(page.getByRole("article")).toHaveCount(2);
  const externalComparison = page.getByRole("article", {
    name: "آگهی منبع مرورگر",
  });
  await expect(externalComparison).toContainText("اختلاف با مشخصات تأییدشده");
  await expect(externalComparison).toContainText(
    "متراژ: منبع ۱۰۸، تأییدشده ۱۱۰",
  );
  await expect(
    externalComparison.getByRole("img", { name: "تصویر آگهی منبع مرورگر" }),
  ).toHaveAttribute(
    "src",
    "https://browser-source.example/media/listings/42.jpg",
  );
  await expect(externalComparison).not.toContainText(
    "third-party.example/hotlink.jpg",
  );
  await expect(
    externalComparison.getByRole("button", { name: "ادامه در منبع اصلی" }),
  ).toBeVisible();
  await page.route("https://browser-source.example/**", async (route) => {
    await route.fulfill({ status: 200, body: "continued" });
  });
  const continuationResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/catalog/listings/${externalListingId}/continuation/`) &&
      response.request().method() === "POST",
  );
  await externalComparison
    .getByRole("button", { name: "ادامه در منبع اصلی" })
    .click();
  expect((await continuationResponse).ok()).toBe(true);
  await expect(page).toHaveURL("https://browser-source.example/listings/42");
  await page.goto(
    "/admin/catalog/productevent/?event_type__exact=external_continuation&period=7d",
  );
  await expect(
    page.getByText("مجموع در بازه و فیلترهای انتخاب‌شده: 1"),
  ).toBeVisible();
  await expect(page.getByText(`${externalListingId}: 1`)).toBeVisible();
  await expect(page.getByText(`${externalSourceId}: 1`)).toBeVisible();

  await page.goto(`/admin/catalog/listing/${externalListingId}/change/`);
  await page.locator("#id_property").selectOption(separatePropertyId!);
  await page.locator('input[name="_save"]').click();
  await page.goto(`/properties/${propertyId}/نشانی-قدیمی`);
  await expect(page.getByRole("article")).toHaveCount(1);

  await page.goto("/admin/catalog/property/");
  const duplicateRow = page.locator("tr").filter({
    has: page.locator(
      `a[href="/admin/catalog/property/${separatePropertyId}/change/"]`,
    ),
  });
  await duplicateRow.locator('input[name="_selected_action"]').check();
  await page
    .locator('select[name="action"]')
    .first()
    .selectOption("merge_into_target");
  await page
    .locator('select[name="target_property"]')
    .first()
    .selectOption(propertyId!);
  await page.locator('button[name="index"]').click();
  await expect(page.getByText("یک ملک تکراری ادغام شد.")).toBeVisible();
  await page.goto(`/properties/${propertyId}/نشانی-قدیمی`);
  await expect(page.getByRole("article")).toHaveCount(2);

  await page.goto(`/admin/catalog/source/${externalSourceId}/change/`);
  await page.locator("#id_is_active").uncheck();
  await page.locator('input[name="_save"]').click();
  await page.goto(`/properties/${propertyId}/نشانی-قدیمی`);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "ادامه در منبع اصلی" }),
  ).toHaveCount(0);
});
