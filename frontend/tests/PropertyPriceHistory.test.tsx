import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { PropertyPriceHistory } from "@/features/catalog/PropertyPriceHistory";
import { propertyDetail } from "./fixtures/catalog";

test("does not fabricate history from current offers", () => {
  render(<PropertyPriceHistory listings={propertyDetail.listings} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/هنوز سابقه کافی/)).toBeVisible();
});

test("plots both prices, including zero rent, with a dated table and separate source histories", async () => {
  render(
    <PropertyPriceHistory
      listings={propertyDetail.listings.map((listing, index) => ({
        ...listing,
        price_history:
          index === 0
            ? [
                {
                  recorded_at: "2026-09-01T10:00:00Z",
                  deposit_toman: 800_000_000,
                  monthly_rent_toman: 0,
                },
                {
                  recorded_at: "2026-09-08T10:00:00Z",
                  deposit_toman: 1_000_000_000,
                  monthly_rent_toman: 25_000_000,
                },
              ]
            : [],
      }))}
    />,
  );
  expect(screen.getByRole("img", { name: /نمودار رهن/ })).toBeVisible();
  expect(
    screen.getByRole("img", { name: /نمودار اجاره ماهانه/ }),
  ).toBeVisible();
  await userEvent.click(screen.getByText("مشاهده تاریخچه قیمت به تفکیک تاریخ"));
  expect(screen.getByRole("cell", { name: "۰" })).toBeVisible();
  expect(screen.getByRole("cell", { name: "۸۰۰٬۰۰۰٬۰۰۰" })).toBeVisible();
  await userEvent.selectOptions(
    screen.getByRole("combobox"),
    propertyDetail.listings[1]!.id,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/هنوز سابقه کافی/)).toBeVisible();
});

test("includes chart point values in server-rendered SVG titles", () => {
  const html = renderToString(
    <PropertyPriceHistory
      listings={[
        {
          ...propertyDetail.listings[0]!,
          price_history: [
            {
              recorded_at: "2026-09-01T10:00:00Z",
              deposit_toman: 800_000_000,
              monthly_rent_toman: 0,
            },
            {
              recorded_at: "2026-09-08T10:00:00Z",
              deposit_toman: 1_000_000_000,
              monthly_rent_toman: 25_000_000,
            },
          ],
        },
      ]}
    />,
  );
  expect(html).toMatch(/<title>[^<]+۸۰۰٬۰۰۰٬۰۰۰ تومان<\/title>/);
  expect(html).not.toContain("<title></title>");
});
