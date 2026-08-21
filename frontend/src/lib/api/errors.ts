function problemDetail(value: unknown) {
  if (value && typeof value === "object" && "errors" in value) {
    const errors = value.errors;
    if (errors && typeof errors === "object") {
      const fieldErrors = Object.values(errors as Record<string, unknown>);
      const firstList = fieldErrors.find((item): item is unknown[] =>
        Array.isArray(item),
      );
      const firstError: unknown = firstList?.[0];
      if (
        firstError &&
        typeof firstError === "object" &&
        "message" in firstError
      ) {
        return String(firstError.message);
      }
    }
  }
  if (value && typeof value === "object" && "detail" in value) {
    return String(value.detail);
  }
  return undefined;
}

export function apiError(value: unknown): Error {
  return new Error(
    problemDetail(value) ?? "در انجام درخواست مشکلی پیش آمد. دوباره تلاش کنید.",
  );
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
