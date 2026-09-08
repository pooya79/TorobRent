import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { PropertyGallery } from "@/features/catalog/PropertyGallery";
import { propertyDetail } from "./fixtures/catalog";

test("switches approved source images and falls back when every image fails", async () => {
  render(
    <PropertyGallery
      property={{
        ...propertyDetail,
        listings: propertyDetail.listings.map((listing) => ({
          ...listing,
          images: [
            {
              id: "one",
              is_primary: true,
              variants: [
                {
                  kind: "medium",
                  url: `/media/${listing.id}-one.webp`,
                  width: 960,
                  height: 640,
                },
              ],
            },
          ],
        })),
      }}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "نمایش تصویر 2 از منبع نمونه" }),
  );
  expect(
    screen.getByRole("button", { name: "نمایش تصویر 2 از منبع نمونه" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.error(screen.getByRole("img", { name: "تصویر ملک از منبع نمونه" }));
  fireEvent.error(
    screen.getByRole("img", { name: "تصویر ملک از منبع مستقیم ترب‌رنت" }),
  );
  expect(screen.getByText("تصویری برای این ملک در دسترس نیست")).toBeVisible();
});
