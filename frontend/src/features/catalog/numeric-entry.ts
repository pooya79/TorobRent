const digitTranslation: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeNumericEntry(value: string) {
  return value
    .replace(/[۰-۹٠-٩]/g, (digit) => digitTranslation[digit] ?? digit)
    .replace(/[٬,\s]/g, "");
}

export function persianDigits(value: string | null) {
  return (
    value?.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] ?? digit) ?? ""
  );
}
