import { expect, test } from "vitest";

import { safeInternalReturnTo } from "@/features/session/return-destination";

test("accepts local return destinations and rejects network-path variants", () => {
  expect(safeInternalReturnTo("/add-submission?step=contact")).toBe(
    "/add-submission?step=contact",
  );
  expect(safeInternalReturnTo("//attacker.example/steal")).toBeUndefined();
  expect(safeInternalReturnTo("/\\attacker.example/steal")).toBeUndefined();
  expect(safeInternalReturnTo("/add-submission\n/steal")).toBeUndefined();
});
