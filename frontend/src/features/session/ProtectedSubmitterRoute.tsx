import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { currentUserQuery, sessionQuery } from "@/features/session/queries";

export function ProtectedSubmitterRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useQuery(sessionQuery);
  const currentUser = useQuery({
    ...currentUserQuery,
    enabled: session.data?.authenticated === true,
  });

  if (
    session.isPending ||
    (session.data?.authenticated && currentUser.isPending)
  ) {
    return (
      <main
        id="main-content"
        className="mx-auto w-full max-w-432 px-4 py-12"
        tabIndex={-1}
      >
        <p>در حال بررسی حساب…</p>
      </main>
    );
  }

  if (!session.data?.authenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  if (!currentUser.data?.phone_verified || !currentUser.data.is_submitter) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/submitter/get-started?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
