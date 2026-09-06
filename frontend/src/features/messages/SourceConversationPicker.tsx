import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { SourceConversationButton } from "@/features/source-proposals/SourceConversationButton";
import { sourceConversationOptions } from "./queries";

export function SourceConversationPicker() {
  const sources = useQuery(sourceConversationOptions);
  const [selectedId, setSelectedId] = useState("");
  const selected = sources.data?.find(
    (source) => source.proposal_id === selectedId,
  );
  return (
    <section
      aria-label="شروع گفت‌وگوی منبع"
      className="mb-5 grid gap-3 rounded-xl border p-4"
    >
      <Label htmlFor="source-conversation-proposal">
        انتخاب منبع برای گفت‌وگو
      </Label>
      {sources.isPending ? (
        <p role="status">در حال بارگذاری منابع…</p>
      ) : sources.isError ? (
        <p role="alert">منابع بارگذاری نشد. دوباره تلاش کنید.</p>
      ) : sources.data.length === 0 ? (
        <p>منبعی برای گفت‌وگو در دسترس نیست.</p>
      ) : (
        <>
          <select
            id="source-conversation-proposal"
            className="border-input bg-background rounded-md border p-2"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">منبع را انتخاب کنید</option>
            {sources.data.map((source) => (
              <option key={source.proposal_id} value={source.proposal_id}>
                {source.website_name}
              </option>
            ))}
          </select>
          {selected && (
            <SourceConversationButton
              proposalId={selected.proposal_id}
              operator={selected.operator}
            />
          )}
        </>
      )}
    </section>
  );
}
