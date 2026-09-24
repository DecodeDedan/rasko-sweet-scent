/**
 * Client-generated UUID primary keys (architecture.md §6.4): a row is created
 * on the device with its final id, so a retried push is a no-op, not a copy.
 * The fallback covers an old WebView without crypto.randomUUID.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  )
}
