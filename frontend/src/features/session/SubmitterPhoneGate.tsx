import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { apiError, errorMessage } from "@/lib/api/errors";

export function SubmitterPhoneGate({ onVerified }: { onVerified: () => void }) {
  const [pendingPhone, setPendingPhone] = useState<{
    identifier: string;
    developmentOtp?: string;
  }>();
  const requestPhone = useMutation({
    mutationFn: async (identifier: string) => {
      const { data, error } = await api.POST(
        "/api/v1/auth/phone-verification/request/",
        { body: { identifier, purpose: "submitter_onboarding" } },
      );
      if (error || !data) throw apiError(error);
      return { identifier, developmentOtp: data.development_otp };
    },
    onSuccess: setPendingPhone,
  });
  const verifyPhone = useMutation({
    mutationFn: async (otp: string) => {
      if (!pendingPhone) throw new Error("شماره تلفن در دسترس نیست.");
      const { data, error } = await api.POST("/api/v1/auth/verify-phone/", {
        body: { identifier: pendingPhone.identifier, otp },
      });
      if (error || !data) throw apiError(error);
      return data;
    },
    onSuccess: onVerified,
  });

  return (
    <Card className="mx-auto max-w-lg shadow-none">
      <CardHeader>
        <h1 className="text-2xl font-semibold">تأیید شماره تلفن حساب</h1>
        <p className="text-muted-foreground leading-7">
          برای دسترسی به مسیر ارسال‌کننده، یک شماره تلفن در دسترس را به همین
          حساب اضافه و تأیید کنید.
        </p>
      </CardHeader>
      <CardContent>
        {pendingPhone ? (
          <form
            key="phone-otp"
            className="grid gap-5"
            onSubmit={(event) => submitOtp(event, verifyPhone.mutate)}
          >
            <div className="grid gap-2">
              <Label htmlFor="submitter-otp">کد تأیید</Label>
              <Input
                id="submitter-otp"
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
                کد پس از ۵ دقیقه منقضی می‌شود و درخواست دوباره پس از ۶۰ ثانیه
                ممکن است.
              </p>
            </div>
            {verifyPhone.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {errorMessage(
                    verifyPhone.error,
                    "کد تأیید پذیرفته نشد. کد تازه‌ای درخواست کنید.",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={verifyPhone.isPending}>
              {verifyPhone.isPending ? "در حال تأیید…" : "تأیید و ادامه"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={requestPhone.isPending}
              onClick={() => requestPhone.mutate(pendingPhone.identifier)}
            >
              ارسال دوباره کد
            </Button>
          </form>
        ) : (
          <form
            key="phone-request"
            className="grid gap-5"
            onSubmit={(event) => submitPhone(event, requestPhone.mutate)}
          >
            <div className="grid gap-2">
              <Label htmlFor="submitter-phone">شماره تلفن</Label>
              <Input
                id="submitter-phone"
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                required
              />
            </div>
            {requestPhone.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {errorMessage(
                    requestPhone.error,
                    "ارسال کد ممکن نشد. دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={requestPhone.isPending}>
              {requestPhone.isPending ? "در حال ارسال…" : "ارسال کد تأیید"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function submitPhone(
  event: FormEvent<HTMLFormElement>,
  submit: (identifier: string) => void,
) {
  event.preventDefault();
  const phone = new FormData(event.currentTarget).get("phone");
  submit(typeof phone === "string" ? phone : "");
}

function submitOtp(
  event: FormEvent<HTMLFormElement>,
  submit: (otp: string) => void,
) {
  event.preventDefault();
  const otp = new FormData(event.currentTarget).get("otp");
  submit(typeof otp === "string" ? otp : "");
}
