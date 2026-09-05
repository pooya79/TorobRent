import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserRound } from "lucide-react";
import type { FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chooseDisplayName } from "@/features/messages/queries";
import { currentUserQuery } from "@/features/session/queries";
import { AccountWorkspace } from "@/features/account/AccountWorkspace";
import { errorMessage } from "@/lib/api/errors";

export function SubmitterProfilePage() {
  const user = useQuery(currentUserQuery);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: chooseDisplayName,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: currentUserQuery.queryKey,
      });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("display_name");
    const name = typeof value === "string" ? value.trim() : "";
    if (name) save.mutate(name);
  }
  return (
    <AccountWorkspace>
      <header className="mb-8">
        <p className="text-primary mb-2 text-sm font-medium">حساب کاربری</p>
        <h1 className="text-3xl font-semibold">پروفایل من</h1>
        <p className="text-muted-foreground mt-3">
          اطلاعات حساب و نامی که در گفت‌وگوها نمایش داده می‌شود.
        </p>
      </header>
      {user.isPending && <p role="status">در حال بارگذاری پروفایل…</p>}
      {user.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            اطلاعات حساب بارگذاری نشد.
            <Button variant="outline" onClick={() => void user.refetch()}>
              تلاش دوباره
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {user.data && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className="shadow-none">
            <CardHeader>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <UserRound aria-hidden="true" className="size-5" />
                اطلاعات شخصی
              </h2>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="display-name">نام نمایشی</Label>
                  <Input
                    id="display-name"
                    name="display_name"
                    disabled={save.isPending}
                    required
                    pattern=".*\S.*"
                    maxLength={120}
                    defaultValue={user.data.display_name}
                    placeholder="نامی که دیگران می‌بینند"
                    aria-describedby="display-name-help"
                    onChange={() => save.reset()}
                  />
                  <p
                    id="display-name-help"
                    className="text-muted-foreground text-sm"
                  >
                    این نام در پیام‌های شما به دیگران نمایش داده می‌شود.
                  </p>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-phone">شماره همراه</Label>
                    <Input
                      id="profile-phone"
                      value={user.data.phone ?? "ثبت نشده"}
                      readOnly
                      dir={user.data.phone ? "ltr" : "rtl"}
                    />
                    <p className="text-muted-foreground text-xs">
                      {user.data.phone_verified
                        ? "شماره همراه تأیید شده است."
                        : "شماره همراه تأیید نشده است."}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-email">ایمیل</Label>
                    <Input
                      id="profile-email"
                      value={user.data.email ?? "ثبت نشده"}
                      readOnly
                      dir={user.data.email ? "ltr" : "rtl"}
                    />
                    <p className="text-muted-foreground text-xs">
                      {user.data.email_verified
                        ? "ایمیل تأیید شده است."
                        : "ایمیل تأیید نشده است."}
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  شماره همراه و ایمیل در این بخش قابل ویرایش نیستند.
                </p>
                {save.isError && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {errorMessage(
                        save.error,
                        "ذخیره نام انجام نشد. دوباره تلاش کنید.",
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {save.isSuccess && (
                  <p role="status" className="text-primary text-sm">
                    نام نمایشی شما ذخیره شد.
                  </p>
                )}
                <Button disabled={save.isPending} type="submit">
                  {save.isPending ? "در حال ذخیره…" : "ذخیره تغییرات"}
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="bg-muted h-fit rounded-2xl p-6">
            <ShieldCheck
              className="text-primary mb-4 size-7"
              aria-hidden="true"
            />
            <h2 className="font-semibold">حریم خصوصی شما</h2>
            <p className="text-muted-foreground mt-3 text-sm leading-7">
              ایمیل حساب شما در آگهی نمایش داده نمی‌شود. شماره تماس هر آگهی را
              هنگام ثبت آن انتخاب و نمایش عمومی آن را تأیید می‌کنید.
            </p>
          </div>
        </div>
      )}
    </AccountWorkspace>
  );
}
