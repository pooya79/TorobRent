import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DevelopmentMailHint } from "@/features/session/DevelopmentMailHint";
import { sessionQuery } from "@/features/session/queries";
import {
  safeInternalReturnTo,
  withReturnTo,
} from "@/features/session/return-destination";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";

type AccountAccessMode = "login" | "register" | "recovery";

const content = {
  login: {
    title: "ورود به ترب‌رنت",
    description: "برای مدیریت و ثبت آگهی‌های اجاره وارد شوید.",
    submit: "ورود",
  },
  register: {
    title: "ساخت حساب ارسال‌کننده",
    description:
      "با ایمیل یا شماره تلفن حساب بسازید و شناسه خود را تأیید کنید.",
    submit: "ساخت حساب",
  },
  recovery: {
    title: "بازیابی گذرواژه",
    description: "پیوند انتخاب گذرواژه جدید برای شما ایمیل می‌شود.",
    submit: "ارسال پیوند بازیابی",
  },
} as const;

export function AccountAccessPage({ mode }: { mode: AccountAccessMode }) {
  const copy = content[mode];
  const session = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedReturnTo = safeInternalReturnTo(searchParams.get("returnTo"));
  const [result, setResult] = useState<string>();
  const [pendingPhone, setPendingPhone] = useState<{
    identifier: string;
    developmentOtp?: string;
  }>();
  const mutation = useMutation({
    mutationFn: async ({
      identifier,
      password,
    }: {
      identifier: string;
      password?: string;
    }) => {
      if (mode === "login") {
        const { data, error } = await api.POST("/api/v1/auth/login/", {
          body: { identifier, password: password ?? "" },
        });
        if (error || !data) throw apiError(error);
        return data;
      }
      if (mode === "register") {
        const { data, error } = await api.POST("/api/v1/auth/register/", {
          body: {
            identifier,
            password: password ?? "",
            ...(requestedReturnTo ? { return_to: requestedReturnTo } : {}),
          },
        });
        if (error || !data) throw apiError(error);
        return data;
      }
      const { data, error } = await api.POST("/api/v1/auth/password-reset/", {
        body: { email: identifier },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: async (data, variables) => {
      if (mode === "login" && "email_verified" in data) {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        void navigate(requestedReturnTo ?? "/dashboard", {
          replace: true,
        });
        return;
      }
      if (
        mode === "register" &&
        "verification_method" in data &&
        data.verification_method === "phone"
      ) {
        setPendingPhone({
          identifier: variables.identifier,
          developmentOtp:
            "development_otp" in data &&
            typeof data.development_otp === "string"
              ? data.development_otp
              : undefined,
        });
      }
      if ("detail" in data) setResult(data.detail);
    },
  });
  const verification = useMutation({
    mutationFn: async (otp: string) => {
      if (!pendingPhone) throw new Error("شماره تلفن در دسترس نیست.");
      const { data, error } = await api.POST("/api/v1/auth/verify-phone/", {
        body: { identifier: pendingPhone.identifier, otp },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (data) => {
      setResult(data.detail);
      void navigate(withReturnTo("/login", requestedReturnTo), {
        replace: true,
      });
    },
  });
  const resend = useMutation({
    mutationFn: async () => {
      if (!pendingPhone) throw new Error("شماره تلفن در دسترس نیست.");
      const { data, error } = await api.POST(
        "/api/v1/auth/phone-verification/request/",
        { body: { identifier: pendingPhone.identifier } },
      );
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: (data) => {
      setPendingPhone((current) =>
        current
          ? {
              ...current,
              developmentOtp: data.development_otp,
            }
          : current,
      );
      setResult(data.detail);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const form = new FormData(event.currentTarget);
    const identifier = form.get("identifier");
    const password = form.get("password");
    mutation.mutate({
      identifier: typeof identifier === "string" ? identifier : "",
      password:
        mode === "recovery"
          ? undefined
          : typeof password === "string"
            ? password
            : "",
    });
  }

  function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const otp = new FormData(event.currentTarget).get("otp");
    verification.mutate(typeof otp === "string" ? otp : "");
  }

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-432 items-center px-4 py-12 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <Card className="mx-auto w-full max-w-lg shadow-none">
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">
            {copy.title}
          </h1>
          <p className="text-muted-foreground text-sm leading-7">
            {copy.description}
          </p>
        </CardHeader>
        <CardContent>
          {pendingPhone ? (
            <form key="phone-otp" className="grid gap-5" onSubmit={submitOtp}>
              <div className="grid gap-2">
                <Label htmlFor="phone-otp">کد تأیید</Label>
                <Input
                  id="phone-otp"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
                {pendingPhone.developmentOtp ? (
                  <p className="text-muted-foreground text-sm">
                    کد توسعه: {pendingPhone.developmentOtp}
                  </p>
                ) : null}
                <p className="text-muted-foreground text-sm">
                  کد پس از ۵ دقیقه منقضی می‌شود. درخواست دوباره پس از ۶۰ ثانیه
                  ممکن است.
                </p>
              </div>
              {result ? (
                <Alert>
                  <AlertDescription>{result}</AlertDescription>
                </Alert>
              ) : null}
              {verification.error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {errorMessage(verification.error, "کد تأیید پذیرفته نشد.")}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" disabled={verification.isPending}>
                {verification.isPending ? "در حال تأیید…" : "تأیید شماره"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
              >
                ارسال دوباره کد
              </Button>
            </form>
          ) : (
            <form key="account-access" className="grid gap-5" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor={`${mode}-identifier`}>
                  {mode === "recovery" ? "ایمیل" : "ایمیل یا شماره تلفن"}
                </Label>
                <Input
                  id={`${mode}-identifier`}
                  name="identifier"
                  type={mode === "recovery" ? "email" : "text"}
                  autoComplete={mode === "recovery" ? "email" : "username"}
                  required
                />
              </div>
              {mode !== "recovery" ? (
                <div className="grid gap-2">
                  <Label htmlFor={`${mode}-password`}>گذرواژه</Label>
                  <Input
                    id={`${mode}-password`}
                    name="password"
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                  />
                </div>
              ) : null}
              {result ? (
                <div className="grid gap-3">
                  <Alert>
                    <AlertDescription>{result}</AlertDescription>
                  </Alert>
                  <DevelopmentMailHint />
                </div>
              ) : null}
              {mutation.error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {errorMessage(
                      mutation.error,
                      "در انجام درخواست مشکلی پیش آمد. دوباره تلاش کنید.",
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                disabled={session.isPending || mutation.isPending}
              >
                {mutation.isPending ? "در حال ارسال…" : copy.submit}
              </Button>
            </form>
          )}
          <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {mode !== "login" ? (
              <Link to={withReturnTo("/login", requestedReturnTo)}>ورود</Link>
            ) : null}
            {mode !== "register" ? (
              <Link to={withReturnTo("/register", requestedReturnTo)}>
                ساخت حساب
              </Link>
            ) : null}
            {mode !== "recovery" ? (
              <Link to="/forgot-password">فراموشی گذرواژه</Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
