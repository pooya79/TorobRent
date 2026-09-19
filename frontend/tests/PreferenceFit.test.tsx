import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { PreferenceFit } from "@/features/catalog/PreferenceFit";
import {
  fitBands,
  fitBandLabels,
  fitBandStars,
} from "@/features/catalog/preferences";
import { fitAppearance } from "@/features/map/fit-appearance";
import { PreferenceMapLegend } from "@/features/map/PreferenceMapLegend";

test.each(fitBands)(
  "card and map agree on the five-star rating for %s",
  (band) => {
    render(
      <PreferenceFit
        assessment={{
          version: "explicit-v2",
          band,
          satisfied: [],
          trade_offs: [],
          unknown: [],
          selected_listing_id: "listing",
        }}
      />,
    );
    const summary = screen.getByLabelText(
      `${fitBandLabels[band]} با ترجیحات شما`,
    );
    expect(summary.querySelectorAll("svg.lucide-star")).toHaveLength(5);
    expect(summary.querySelectorAll("svg.fill-amber-500")).toHaveLength(
      fitBandStars[band],
    );
    const marker = fitAppearance(band, false);
    expect([...marker.symbol].filter((star) => star === "★")).toHaveLength(
      fitBandStars[band],
    );
    expect(marker.number).toBe(
      new Intl.NumberFormat("fa-IR").format(fitBandStars[band]),
    );
    expect(fitAppearance(band, true).outlineWidth).toBeGreaterThan(
      marker.outlineWidth,
    );
  },
);

test("unknown fit is distinct from one star and from disabled preferences", () => {
  expect(fitAppearance(null, false).number).toBe("؟");
  expect(fitAppearance(null, false).symbol).not.toContain("★");
  expect(fitAppearance(undefined, false).number).toBe("");
  expect(
    new Set(fitBands.map((band) => fitAppearance(band, false).shape)).size,
  ).toBe(5);
});

test("map legend explains all five ratings and can be expanded", async () => {
  render(<PreferenceMapLegend />);
  await userEvent.click(
    screen.getByText("تناسب با ترجیحات شما · ۱ تا ۵ ستاره"),
  );
  const legend = screen.getByLabelText("راهنمای تناسب با ترجیحات");
  expect(within(legend).getAllByRole("listitem")).toHaveLength(5);
  for (const band of fitBands)
    expect(within(legend).getByText(fitBandLabels[band])).toBeVisible();
});
