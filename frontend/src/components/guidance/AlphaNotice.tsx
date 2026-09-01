import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function AlphaNotice() {
  return (
    <Alert>
      <AlertTitle>نسخه آلفای محلی</AlertTitle>
      <AlertDescription className="leading-7">
        اطلاعات نسخه آلفا از داده‌های ساختگی و ورود دستی اپراتور ساخته شده‌اند؛
        این اطلاعات موجودی زنده سامانه‌های گردآورنده آگهی نیستند و ممکن است برای
        تصمیم‌گیری واقعی به‌روز نباشند.
      </AlertDescription>
    </Alert>
  );
}
