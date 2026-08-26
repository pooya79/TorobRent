import { expect, test } from "@playwright/test";

const tehranId = "11111111-1111-4111-8111-111111111111";

test.beforeEach(({ page }) => {
  test.skip(
    !process.env.E2E_SEED_DEMO,
    "Integrated discovery requires the deterministic demo catalog",
  );
  page.setDefaultTimeout(10_000);
});

test("integrates desktop Property discovery, restoration, and anonymous Favorites", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");

  await page.getByRole("link", { name: "مشاهدهٔ ملک‌های تهران" }).click();
  const toolbar = page.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await expect(page.getByText("۲۴ ملک پیدا شد")).toBeVisible();
  const city = toolbar.getByRole("combobox", { name: "شهر" });
  await city.fill("ته");
  await page.getByRole("option", { name: "تهران" }).click();
  await expect(city).toHaveValue("تهران");
  const commercialCategory = toolbar.getByRole("button", { name: "تجاری" });
  await commercialCategory.click();
  await expect(commercialCategory).toHaveAttribute("aria-pressed", "true");

  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        pathname: url.pathname,
        city: url.searchParams.get("location"),
        category: url.searchParams.get("property_category"),
      };
    })
    .toEqual({
      pathname: "/search",
      city: tehranId,
      category: "commercial",
    });
  await expect(page.getByText("۳۰ ملک پیدا شد")).toBeVisible();
  await expect(
    page.getByText("از این تعداد، ۳۰ ملک روی نقشه است"),
  ).toBeVisible();
  const firstTabletCard = await page.getByRole("article").first().boundingBox();
  expect(firstTabletCard?.width).toBeGreaterThanOrEqual(256);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();

  const serverDocument = await request.get(page.url());
  expect(serverDocument.ok()).toBe(true);
  expect(await serverDocument.text()).toContain(
    '<meta name="robots" content="noindex, follow"',
  );

  const viewportControl = page.getByRole("button", {
    name: "تغییر محدوده آزمایشی",
  });
  await viewportControl.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/viewport_zoom=12/);
  await expect(page.getByText("۳۰ ملک در این محدوده پیدا شد")).toBeVisible();

  await page.getByRole("button", { name: "نمایش ملک‌های بیشتر" }).click();
  await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
  await expect(page.getByRole("article")).toHaveCount(30);

  const restoredProperty = page.getByRole("article").last();
  const restoredTitle = await restoredProperty.getAttribute("aria-label");
  expect(restoredTitle).toBeTruthy();
  await restoredProperty.getByRole("link", { name: restoredTitle! }).click();
  await expect(
    page.getByRole("link", { name: "بازگشت به نتایج" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "بازگشت به نتایج" }).click();
  await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
  await expect(page.getByRole("article")).toHaveCount(30);

  const favoriteCard = page.getByRole("article").first();
  const favoriteTitle = await favoriteCard.getAttribute("aria-label");
  expect(favoriteTitle).toBeTruthy();
  const favorite = favoriteCard.getByRole("button", {
    name: `ذخیره ${favoriteTitle!} در علاقه‌مندی‌ها`,
  });
  await favorite.click();

  const signInDialog = page.getByRole("dialog", { name: "ورود به ترب‌رنت" });
  await signInDialog.getByRole("button", { name: "ساخت حساب" }).click();
  const registration = page.getByRole("dialog", {
    name: "ساخت حساب اجاره‌جو",
  });
  await registration
    .getByLabel("ایمیل")
    .fill(`renter-${Date.now()}@example.com`);
  await registration.getByLabel("گذرواژه").fill("correct-horse-battery");
  await registration.getByRole("button", { name: "ساخت حساب و ادامه" }).click();
  await expect(
    favoriteCard.getByRole("button", {
      name: `حذف ${favoriteTitle!} از علاقه‌مندی‌ها`,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "علاقه‌مندی‌ها" }).click();
  await expect(page).toHaveURL(/\/favorites$/);
  await expect(
    page.getByRole("article", { name: favoriteTitle! }),
  ).toBeVisible();
});

test("keeps mobile filters, map previews, and Favorite intent keyboard operable", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const search = new URLSearchParams({
    location: "تهران",
    location_label: "تهران",
    property_category: "commercial",
    viewport_north: "35.82",
    viewport_east: "51.52",
    viewport_south: "35.65",
    viewport_west: "51.25",
    viewport_zoom: "14",
  });
  await page.goto(`/search?${search.toString()}`);
  await expect(page.getByText("۳۰ ملک در این محدوده پیدا شد")).toBeVisible();

  const filtersTrigger = page.getByRole("button", {
    name: "فیلترهای پیشرفته",
  });
  await filtersTrigger.focus();
  await expect(filtersTrigger).toBeFocused();
  await filtersTrigger.press("Enter");
  const filters = page.getByRole("dialog", { name: "فیلترهای پیشرفته" });
  await expect(filters).toBeVisible();
  const filtersBox = await filters.boundingBox();
  expect(filtersBox?.width).toBeGreaterThanOrEqual(389);
  expect(filtersBox?.height).toBeGreaterThanOrEqual(843);
  await filters.getByLabel("حداکثر متراژ", { exact: true }).fill("۱۶۰");
  await filters.getByRole("button", { name: /نمایش .* ملک/ }).click();
  await expect(page).toHaveURL(/area_max=160/);
  await expect(filtersTrigger).toBeFocused();

  const mapTrigger = page.getByRole("button", {
    name: "نمایش نقشه تمام‌صفحه",
  });
  await mapTrigger.focus();
  await expect(mapTrigger).toBeFocused();
  await mapTrigger.press("Enter");
  const mapSheet = page.getByRole("dialog", {
    name: "نقشه تمام‌صفحه ملک‌ها",
  });
  await expect(mapSheet).toBeVisible();
  const mapSheetBox = await mapSheet.boundingBox();
  expect(mapSheetBox?.width).toBeGreaterThanOrEqual(389);
  expect(mapSheetBox?.height).toBeGreaterThanOrEqual(843);
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      mapSheet.evaluate((sheet) => sheet.contains(document.activeElement)),
    )
    .toBe(true);

  const marker = mapSheet.getByRole("button", { name: /^انتخاب / }).first();
  await marker.focus();
  await marker.press("Enter");
  const preview = mapSheet.getByRole("region", { name: /^پیش‌نمایش / });
  await expect(preview).toBeFocused();
  const previewBox = await preview.boundingBox();
  expect(
    previewBox && 844 - (previewBox.y + previewBox.height),
  ).toBeLessThanOrEqual(16);

  const favorite = preview.getByRole("button", {
    name: /^ذخیره .* در علاقه‌مندی‌ها$/,
  });
  await expect(favorite).toBeEnabled();
  await favorite.focus();
  await favorite.press("Enter");
  const signInDialog = page.getByRole("dialog", { name: "ورود به ترب‌رنت" });
  await expect(signInDialog).toBeVisible();
  const closeSignIn = signInDialog.getByRole("button", { name: "بستن" });
  await closeSignIn.focus();
  await closeSignIn.press("Enter");
  await expect(signInDialog).toHaveCount(0);
  await expect(favorite).toBeFocused();

  const closePreview = preview.getByRole("button", {
    name: "بستن پیش‌نمایش",
  });
  await closePreview.focus();
  await closePreview.press("Enter");
  await expect(preview).toHaveCount(0);
  await expect(marker).toBeFocused();

  const closeMap = mapSheet.getByRole("button", { name: "بستن" });
  await closeMap.focus();
  await closeMap.press("Enter");
  await expect(mapSheet).toHaveCount(0);
  await expect(mapTrigger).toBeFocused();
});
