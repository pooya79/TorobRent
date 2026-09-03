import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { ThemeProvider } from "@/app/ThemeProvider";
import { RenterAccessProvider } from "@/features/session/RenterAccessDialog";
import { rememberCsrfToken } from "@/lib/api/client";

export function AppProviders({
  children,
  dehydratedState,
  csrfToken,
}: {
  children: ReactNode;
  dehydratedState?: DehydratedState;
  csrfToken?: string;
}) {
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined" && csrfToken) {
      rememberCsrfToken(csrfToken);
    }
    return new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
    });
  });
  useEffect(() => {
    if (csrfToken) rememberCsrfToken(csrfToken);
  }, [csrfToken]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <RenterAccessProvider>{children}</RenterAccessProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
