import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sessionQuery } from "@/features/session/queries";
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
    description: "پس از ثبت‌نام، ایمیل خود را تأیید کنید.",
    submit: "ساخت حساب",
  },
  recovery: {
    title: "بازیابی گذرواژه",
    description: "پیوند انتخاب گذرواژه جدید برای شما ایمیل می‌شود.",
    submit: "ارسال پیوند بازیابی",
  },
} as const;

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/dashboard";
}

export function AccountAccessPage({ mode }: { mode: AccountAccessMode }) {
  const copy = content[mode];
  const session = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<string>();
  const mutation = useMutation({
    mutationFn: async ({
      email,
      password,
    }: {
      email: string;
      password?: string;
    }) => {
      if (mode === "login") {
        const { data, error } = await api.POST("/api/v1/auth/login/", {
          body: { email, password: password ?? "" },
        });
        if (error || !data) throw apiError(error);
        return data;
      }
      if (mode === "register") {
        const { data, error } = await api.POST("/api/v1/auth/register/", {
          body: { email, password: password ?? "" },
        });
        if (error || !data) throw apiError(error);
        return data;
      }
      const { data, error } = await api.POST("/api/v1/auth/password-reset/", {
        body: { email },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: async (data) => {
      if (mode === "login" && "email_verified" in data) {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        if (!data.email_verified) {
          setResult(
            "برای ادامه، ابتدا ایمیل خود را از طریق پیام ارسال‌شده تأیید کنید.",
          );
          return;
        }
        void navigate(safeReturnTo(searchParams.get("returnTo")), {
          replace: true,
        });
        return;
      }
      if ("detail" in data) setResult(data.detail);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    mutation.mutate({
      email: typeof email === "string" ? email : "",
      password:
        mode === "recovery"
          ? undefined
          : typeof password === "string"
            ? password
            : "",
    });
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
          <form className="grid gap-5" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor={`${mode}-email`}>ایمیل</Label>
              <Input
                id={`${mode}-email`}
                name="email"
                type="email"
                autoComplete="email"
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
              <Alert>
                <AlertDescription>{result}</AlertDescription>
              </Alert>
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
          <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {mode !== "login" ? <Link to="/login">ورود</Link> : null}
            {mode !== "register" ? <Link to="/register">ساخت حساب</Link> : null}
            {mode !== "recovery" ? (
              <Link to="/forgot-password">فراموشی گذرواژه</Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
