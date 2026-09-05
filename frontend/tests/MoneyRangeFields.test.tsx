import { expect, test } from "vitest";
import { moneyInToman } from "@/features/catalog/MoneyRangeFields";

test.each([
  ["۱٫۵", 1_000_000_000, "1500000000"],
  ["١٢٫٥", 1_000_000, "12500000"],
  ["۱٬۵۰۰", 1_000_000, "1500000000"],
  ["0.000001", 1_000_000, "1"],
  ["1.000000001", 1_000_000_000, "1000000001"],
  ["0", 1_000_000, "0"],
  ["", 1_000_000, ""],
  ["-2", 1_000_000, undefined],
  ["1.2.3", 1_000_000, undefined],
  ["0.0000001", 1_000_000, undefined],
  ["9999999999999", 1_000_000, undefined],
])("converts %s at unit %s without rounding money", (value, unit, expected) => {
  expect(moneyInToman(value, unit)).toBe(expected);
});
