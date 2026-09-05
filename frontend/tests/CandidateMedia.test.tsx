import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  CandidateMedia,
  type MediaChoice,
} from "@/features/source-proposals/CandidateMedia";

it("lets an Operator reorder, exclude, select a primary, and explicitly accept a Property Image", async () => {
  const user = userEvent.setup();
  const images = ["first", "second"].map((id, index) => ({
    id,
    original_url: `https://source.example/${id}`,
    source_order: index,
    position: index,
    is_primary: index === 0,
    excluded: false,
    state: "ready",
    failure_code: "",
    content_hash: "hash",
    accepted_at: null,
    accepted_by: null,
    variants: [
      {
        kind: "small",
        url: `/api/thumbnail/${id}`,
        width: 40,
        height: 30,
        byte_size: 100,
      },
    ],
  }));
  function Harness() {
    const [choices, setChoices] = useState<MediaChoice[]>(
      images.map((image) => ({
        id: image.id,
        excluded: false,
        is_primary: image.is_primary,
        accept_as_property: false,
      })),
    );
    return (
      <>
        <CandidateMedia
          images={images}
          choices={choices}
          onChange={setChoices}
        />
        <output data-testid="choices">{JSON.stringify(choices)}</output>
      </>
    );
  }
  render(<Harness />);
  expect(screen.getAllByRole("img")[0]).toHaveAttribute(
    "src",
    "/api/thumbnail/first",
  );
  await user.click(screen.getByRole("button", { name: "تصویر ۲ به بالا" }));
  await user.click(screen.getAllByLabelText("تصویر اصلی")[0]!);
  await user.click(screen.getAllByLabelText("پذیرش به عنوان تصویر ملک")[0]!);
  await user.click(screen.getAllByLabelText("حذف از انتشار")[1]!);
  expect(JSON.parse(screen.getByTestId("choices").textContent)).toEqual([
    {
      id: "second",
      excluded: false,
      is_primary: true,
      accept_as_property: true,
    },
    {
      id: "first",
      excluded: true,
      is_primary: false,
      accept_as_property: false,
    },
  ]);
});
