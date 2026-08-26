import { expect, test } from "vitest";

import { validateCityImages } from "../scripts/check-city-images";

test("validates local city images, credits, formats, and size budgets", () => {
  expect(validateCityImages(process.cwd()).count).toBe(10);
});
