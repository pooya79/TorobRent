import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { sessionQuery } from "@/features/session/queries";
import { safeInternalReturnTo } from "@/features/session/return-destination";
import { SubmitterPhoneGate } from "@/features/session/SubmitterPhoneGate";
import {
  SubmitterPathChoice,
  type SubmitterOnboardingPath,
} from "@/features/session/SubmitterPathChoice";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";

type OnboardingState = {
  eligible: boolean;
  phone_verified: boolean;
  selected_path: SubmitterOnboardingPath | null;
};

const onboardingQueryKey = ["submitter-onboarding"] as const;

function onboardingDestination(
  path: SubmitterOnboardingPath | null | undefined,
  returnTo: string | null | undefined,
) {
  if (path === "submission") return returnTo ?? "/add-submission";
  return path && returnTo ? returnTo : null;
}

export function SubmitterOnboardingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeInternalReturnTo(searchParams.get("returnTo"));
  const session = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const onboarding = useQuery({
    queryKey: onboardingQueryKey,
    enabled: session.data?.authenticated === true,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/users/me/submitter-onboarding/",
      );
      if (error || !data) throw apiError(error);
      return data;
    },
  });
  const update = useMutation({
    mutationFn: async (selectedPath?: SubmitterOnboardingPath) => {
      const { data, error } = await api.POST(
        "/api/v1/users/me/submitter-onboarding/",
        {
          body: selectedPath ? { selected_path: selectedPath } : {},
        },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (data, selectedPath) => {
      queryClient.setQueryData(onboardingQueryKey, data);
      const destination =
        selectedPath === "source_proposal"
          ? (returnTo ?? "/source-proposal")
          : onboardingDestination(selectedPath, returnTo);
      if (destination) void navigate(destination, { replace: true });
    },
  });
  useEffect(() => {
    if (
      onboarding.data?.phone_verified &&
      !onboarding.data.eligible &&
      !update.isPending &&
      !update.isError
    ) {
      update.mutate(undefined);
    }
  }, [onboarding.data, update]);

  useEffect(() => {
    const destination = onboardingDestination(
      onboarding.data?.selected_path,
      returnTo,
    );
    if (destination) void navigate(destination, { replace: true });
  }, [navigate, onboarding.data?.selected_path, returnTo]);

  if (session.isPending) return <LoadingState />;

  if (!session.data?.authenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  if (onboarding.isPending || update.isPending) return <LoadingState />;

  if (onboarding.error || update.error) {
    return (
      <PageFrame>
        <Alert variant="destructive">
          <AlertDescription>
            {errorMessage(
              onboarding.error ?? update.error,
              "ادامه مسیر ارسال‌کننده ممکن نشد. دوباره تلاش کنید.",
            )}
          </AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  if (!onboarding.data?.phone_verified) {
    return (
      <PageFrame>
        <SubmitterPhoneGate
          onVerified={() => {
            queryClient.setQueryData<OnboardingState>(
              onboardingQueryKey,
              (current) => ({
                eligible: true,
                phone_verified: true,
                selected_path: current?.selected_path ?? null,
              }),
            );
          }}
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <SubmitterPathChoice
        selectedPath={onboarding.data.selected_path}
        pending={update.isPending}
        onSelect={(path) => update.mutate(path)}
      />
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      {children}
    </main>
  );
}

function LoadingState() {
  return (
    <PageFrame>
      <p role="status">در حال بررسی حساب…</p>
    </PageFrame>
  );
}
