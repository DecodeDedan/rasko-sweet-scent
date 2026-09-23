/**
 * The complete server surface the sync engine uses.
 *
 * Same seam as AuthGateway: two methods, one implementation against supabase-js
 * and one in-memory mock for the T1–T6 integration tests. Feature code never
 * sees this — it reads and writes the local database only.
 */

export interface PullCursor {
  /** Value of the table's cursor column (updated_at, or created_at/recorded_at). */
  value: string
  id: string
}

export interface PullPage {
  rows: Record<string, unknown>[]
  cursor: PullCursor | null
  hasMore: boolean
}

export interface PushRejection {
  id: string
  reason: string
  /**
   * True when the server will never accept this row — a constraint violation or
   * an RLS refusal. Permanent rejections go to outbox_dead; anything else stays
   * queued for retry.
   */
  permanent: boolean
}

export interface PushResult {
  rejected: PushRejection[]
}

export interface SyncRemote {
  pull(table: string, cursor: PullCursor | null, limit: number): Promise<PullPage>
  push(
    table: string,
    rows: Record<string, unknown>[],
    options: { appendOnly: boolean },
  ): Promise<PushResult>
}

/**
 * The server refused us, rather than being unreachable.
 *
 * This is the T4 signal: a user deactivated while offline gets this on their
 * next sync, and the app must stop and re-check the identity rather than retry.
 */
export class SyncAuthError extends Error {
  constructor(message = 'The server refused this device.') {
    super(message)
    this.name = 'SyncAuthError'
  }
}

/** The server could not be reached. Keep the queue and try again later. */
export class SyncTransportError extends Error {
  constructor(message = 'Cannot reach the server.') {
    super(message)
    this.name = 'SyncTransportError'
  }
}
