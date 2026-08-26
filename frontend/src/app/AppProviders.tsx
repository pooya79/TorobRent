import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ThemeProvider } from "@/app/ThemeProvider";
import { RenterAccessProvider } from "@/features/session/RenterAccessDialog";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RenterAccessProvider>{children}</RenterAccessProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
