function problemFields(value: unknown) {
  const fields: Record<string, string> = {};
  if (value && typeof value === "object" && "errors" in value) {
    const errors = value.errors;
    if (errors && typeof errors === "object") {
      for (const [field, fieldErrors] of Object.entries(
        errors as Record<string, unknown>,
      )) {
        const firstError: unknown = Array.isArray(fieldErrors)
          ? (fieldErrors as unknown[])[0]
          : null;
        if (
          firstError &&
          typeof firstError === "object" &&
          "message" in firstError
        ) {
          const message: unknown = firstError.message;
          if (typeof message === "string") fields[field] = message;
        }
      }
    }
  }
  return fields;
}

function problemDetail(value: unknown, fields: Record<string, string>) {
  const firstFieldMessage = Object.values(fields)[0];
  if (firstFieldMessage) return firstFieldMessage;
  if (value && typeof value === "object" && "detail" in value) {
    return typeof value.detail === "string" ? value.detail : undefined;
  }
  return undefined;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

export function apiError(value: unknown): ApiError {
  const fields = problemFields(value);
  return new ApiError(
    problemDetail(value, fields) ??
      "در انجام درخواست مشکلی پیش آمد. دوباره تلاش کنید.",
    fields,
  );
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
