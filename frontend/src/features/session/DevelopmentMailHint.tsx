function developmentMailInboxUrl() {
  const value: unknown = import.meta.env.VITE_MAILPIT_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function DevelopmentMailHint() {
  const inboxUrl = developmentMailInboxUrl();
  if (!inboxUrl) return null;

  return (
    <p className="text-muted-foreground text-sm leading-7">
      در محیط توسعه یا دمو، پیام فرستاده‌شده به ایمیل خود را در{" "}
      <a
        className="text-foreground underline underline-offset-4"
        href={inboxUrl}
        rel="noreferrer"
        target="_blank"
      >
        صندوق ایمیل Mailpit
      </a>{" "}
      پیدا کنید و پیوند داخل آن را باز کنید.
    </p>
  );
}
