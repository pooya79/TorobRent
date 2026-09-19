import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ProfileOverview } from "@/features/source-proposals/ProfileOverview";
import type { components } from "@/lib/api/schema";

const version = {
  number: 1,
  provenance: "discovery",
  rules: {
    title: {
      variants: [
        { kind: "json", path: "$.name" },
        { kind: "css", selector: "h1" },
      ],
    },
    description: { kind: "css", selector: 'meta[name="description"]' },
  },
  samples: [
    {
      normalized: {
        title: "آگهی",
        bedroom_count: 0,
        parking: "unknown",
        floor_area_sqm: 80,
        image_urls: [],
        city: "تهران",
      },
      unresolved: ["city"],
      conflicts: { floor_area_sqm: [80, 90] },
    },
  ],
  validation: { training_page_urls: ["/one"], held_out_page_urls: [] },
} as unknown as components["schemas"]["SourceProfileVersion"];

test("summarizes mixed rules and counts zero as recognized while excluding missing and conflicting fields", () => {
  render(
    <ProfileOverview
      version={version}
      renderingMethods={{ http: 2, browser: 1 }}
    />,
  );
  expect(screen.getByText("ترکیبی")).toBeInTheDocument();
  expect(screen.getByText("۱ فیلد")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2");
  expect(screen.getByText("مرورگر استفاده شد")).toBeInTheDocument();
});

test("does not infer rendering requirements from legacy evidence or rule kinds", () => {
  const { rerender } = render(<ProfileOverview version={version} />);
  expect(screen.getByText("هنوز مشخص نیست")).toBeInTheDocument();
  rerender(
    <ProfileOverview version={version} renderingMethods={{ http: 3 }} />,
  );
  expect(screen.getByText("HTML کافی بود")).toBeInTheDocument();
});
