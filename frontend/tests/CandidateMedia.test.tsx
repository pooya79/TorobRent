import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CandidateMedia } from "@/features/source-proposals/CandidateMedia";

it("shows source images", () => {
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
  render(<CandidateMedia images={images} />);
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getAllByRole("img")[0]).toHaveAttribute(
    "src",
    "/api/thumbnail/first",
  );
});
