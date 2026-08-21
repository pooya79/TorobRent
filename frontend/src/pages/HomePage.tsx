import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { currentUserQuery, sessionQuery } from "@/features/session/queries";
import { api } from "@/lib/api/client";

function StatusCard({
  title,
  value,
  healthy,
}: {
  title: string;
  value: string;
  healthy: boolean;
}) {
  return (
    <div className="bg-card rounded-lg border p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          {title}
        </span>
        <CheckCircle2
          className={
            healthy ? "size-5 text-emerald-600" : "text-destructive size-5"
          }
        />
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

export function HomePage() {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/system/ready/");
      if (error || !data) return { status: "unavailable" as const };
      return data;
    },
  });
  const user = useQuery({
    ...currentUserQuery,
    enabled: session.data?.authenticated === true,
  });

  const refresh = () => void queryClient.invalidateQueries();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <div className="bg-card text-muted-foreground mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
            <ShieldCheck className="text-primary size-4" /> Smart rental search
            platform
          </div>
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            TorobRent
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
            A smart rental search platform that aggregates, normalizes, and
            ranks property listings from multiple sources.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          aria-label="Refresh status"
        >
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2" aria-label="System status">
        <StatusCard
          title="API dependencies"
          value={
            health.isPending
              ? "Checking…"
              : health.data?.status === "ok"
                ? "Ready"
                : "Unavailable"
          }
          healthy={health.data?.status === "ok"}
        />
        <StatusCard
          title="Browser session"
          value={
            session.isPending
              ? "Checking…"
              : session.data?.authenticated
                ? (user.data?.email ?? "Authenticated")
                : "Anonymous"
          }
          healthy={!session.isError}
        />
      </section>

      <div className="text-muted-foreground mt-8 flex items-center gap-2 text-sm">
        <Activity className="size-4" /> API types are generated from the
        committed OpenAPI contract.
      </div>
    </main>
  );
}
