export function updateQueueFilter(
  current: URLSearchParams,
  key: string,
  value: string,
  pageKey: string,
) {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete(pageKey);
  return next;
}

export function updateQueuePage(
  current: URLSearchParams,
  pageKey: string,
  page: number,
) {
  const next = new URLSearchParams(current);
  next.set(pageKey, String(Math.max(1, page)));
  return next;
}
