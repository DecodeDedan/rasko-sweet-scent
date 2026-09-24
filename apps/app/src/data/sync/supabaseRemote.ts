import type { SupabaseClient } from '@supabase/supabase-js'

import { cursorColumn, tableSpec } from '../sqlite/tables.js'
import { SyncAuthError, SyncTransportError } from './remote.js'
import type { PullPage, PushResult, SyncRemote } from './remote.js'

/** PostgREST refuses very large IN lists; batches stay well inside that. */
export const PUSH_BATCH = 200
export const PULL_PAGE = 500

function classify(error: { code?: string; message: string }): Error {
  const code = error.code ?? ''
  // 42501 insufficient_privilege, PGRST301 JWT expired.
  if (
    code === '42501' ||
    code.startsWith('PGRST3') ||
    /jwt|permission denied/i.test(error.message)
  ) {
    return new SyncAuthError(error.message)
  }
  if (/fetch|network|timeout/i.test(error.message)) {
    return new SyncTransportError(error.message)
  }
  return new Error(error.message)
}

export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  return {
    async instanceId(): Promise<string | null> {
      const { data, error } = await client.rpc('server_instance_id')
      // PGRST202: no such function, a server from before the migration.
      if (error?.code === 'PGRST202') return null
      if (error) throw classify(error)
      return typeof data === 'string' ? data : null
    },

    async pull(table, cursor, limit): Promise<PullPage> {
      const spec = tableSpec(table)
      const column = cursorColumn(spec)

      let query = client
        .from(table)
        .select('*')
        .order(column, { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)

      if (cursor) {
        /*
         * The keyset comparison from architecture.md §6.2, expressed the only
         * way PostgREST can express a row-value comparison:
         *
         *   (updated_at, id) > (:value, :id)
         *
         * becomes
         *
         *   updated_at.gt.<value>, or updated_at.eq.<value> and id.gt.<id>
         *
         * A plain `updated_at > cursor` would permanently skip every row that
         * shares the boundary timestamp beyond the page limit; `>=` would repeat
         * the last page forever. Neither failure is visible until a page
         * boundary happens to land on a duplicated timestamp.
         */
        query = query.or(
          `${column}.gt.${cursor.value},and(${column}.eq.${cursor.value},id.gt.${cursor.id})`,
        )
      }

      const { data, error } = await query
      if (error) throw classify(error)

      const rows = (data ?? []) as Record<string, unknown>[]
      const last = rows.at(-1)

      return {
        rows,
        cursor: last ? { value: String(last[column] ?? ''), id: String(last['id'] ?? '') } : cursor,
        hasMore: rows.length === limit,
      }
    },

    async push(table, rows, options): Promise<PushResult> {
      if (rows.length === 0) return { rejected: [] }

      /*
       * Idempotency rests on client-generated UUID primary keys
       * (architecture.md §6.4). A push whose response was lost to a dropped
       * connection resolves to a no-op on retry rather than a duplicate — which
       * is what T6 exercises.
       *
       * Append-only tables degrade to ignoreDuplicates, the strongest guarantee
       * available: a payment can be pushed any number of times and exists once.
       */
      const { error } = await client
        .from(table)
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: options.appendOnly })

      if (!error) return { rejected: [] }

      const classified = classify(error)
      if (classified instanceof SyncAuthError || classified instanceof SyncTransportError) {
        throw classified
      }

      // A constraint violation is permanent: retrying cannot help, and leaving
      // it queued would block every later write behind it.
      return {
        rejected: rows.map((row) => ({
          id: String(row['id']),
          reason: error.message,
          permanent: true,
        })),
      }
    },
  }
}
