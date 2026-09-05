import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { apiError } from "@/lib/api/errors";
import { sourceProposalsQueryOptions } from "./queries";

export function ExtractionRequestForm({
  proposalId,
  assignmentId,
}: {
  proposalId: string;
  assignmentId: number;
}) {
  const [url, setUrl] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/source-proposals/{proposal_id}/extraction-requests/",
        {
          params: { path: { proposal_id: proposalId } },
          body: { assignment: assignmentId, url },
        },
      );
      if (error || !data) throw apiError(error);
    },
    onSuccess: async () => {
      setUrl("");
      await client.invalidateQueries({
        queryKey: sourceProposalsQueryOptions.queryKey,
      });
    },
  });
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <Label htmlFor={`extraction-${assignmentId}`}>نشانی برای استخراج</Label>
      <Input
        id={`extraction-${assignmentId}`}
        type="url"
        dir="ltr"
        required
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <Button disabled={mutation.isPending || !url.trim()}>
        درخواست استخراج
      </Button>
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {mutation.isSuccess && <p role="status">درخواست استخراج ثبت شد.</p>}
    </form>
  );
}
