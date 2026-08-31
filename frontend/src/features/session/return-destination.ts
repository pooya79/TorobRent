export function safeInternalReturnTo(value: string | null) {
  const hasUnsafeCharacter = [...(value ?? "")].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character === "\\" || codePoint < 32 || codePoint === 127;
  });
  if (!value?.startsWith("/") || value.startsWith("//") || hasUnsafeCharacter) {
    return undefined;
  }
  return value;
}

export function withReturnTo(path: string, returnTo: string | undefined) {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
