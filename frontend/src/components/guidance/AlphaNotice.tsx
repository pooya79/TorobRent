import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function AlphaNotice() {
  return (
    <Alert>
      <AlertTitle>نسخه آلفای محلی</AlertTitle>
      <AlertDescription className="leading-7">
        اطلاعات از پیشنهادهای تأییدشده و استخراج منابع مجاز فراهم می‌شوند. موجود
        بودن ملک و شرایط آگهی را پیش از تصمیم‌گیری با منبع آگهی بررسی کنید؛
        استخراج اطلاعات به معنی تضمین به‌روز بودن آن نیست.
      </AlertDescription>
    </Alert>
  );
}
