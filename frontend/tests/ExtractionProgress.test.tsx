import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ExtractionProgress } from "@/features/source-proposals/ExtractionProgress";
import type { components } from "@/lib/api/schema";

test("shows discovery progress before extraction and then approval-ready results", () => {
  const request = {
    state: "running",
    max_pages: 300,
    target_detail_pages: 200,
    run: {
      stage: "discovering",
      attempted_pages: 100,
      discovered: 90,
      extracted: 0,
      published: 0,
    },
  } as components["schemas"]["ExtractionRequest"];
  const { rerender } = render(<ExtractionProgress request={request} />);
  expect(screen.getByRole("heading")).toHaveTextContent("کشف و شناسایی صفحات");
  expect(screen.getByText("۱۰۰ / ۳۰۰")).toBeVisible();
  expect(screen.getByText("۹۰ / ۲۰۰")).toBeVisible();
  expect(screen.getByText(/ساخت نتایج پس از پایان این مرحله/)).toBeVisible();
  rerender(
    <ExtractionProgress
      request={{ ...request, run: { ...request.run!, stage: "extracting" } }}
    />,
  );
  expect(screen.getByRole("heading")).toHaveTextContent(
    "استخراج اطلاعات آگهی‌ها",
  );
  rerender(
    <ExtractionProgress
      request={{
        ...request,
        state: "complete",
        run: { ...request.run!, ready_count: 80 },
      }}
    />,
  );
  expect(screen.getByText(/۸۰ آگهی آماده تأیید/)).toBeVisible();
  expect(screen.queryByText("در حال انجام")).not.toBeInTheDocument();
});
