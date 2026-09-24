import { describe, expect, it, vi } from 'vitest'

// The plugin is the boundary: a fake that records the order calls reach it
// and, like the real one, rejects with a bare string.
const log: string[] = []
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => ({
      execute: async (sql: string) => {
        log.push(sql)
        await new Promise((resolve) => setTimeout(resolve, 1))
        if (sql === 'FAIL') throw 'error returned from database: no such table: nope'
        return { rowsAffected: 1 }
      },
      select: async (sql: string) => {
        log.push(sql)
        return []
      },
      close: async () => undefined,
    }),
  },
}))

const { openTauriDatabase } = await import('../sqlite/tauriDatabase.js')

describe('device database adapter', () => {
  it('never lets another call land inside a running transaction', async () => {
    log.length = 0
    const db = await openTauriDatabase()

    // A sync cycle's transaction and a user's write, started together.
    await Promise.all([
      db.transaction(async (tx) => {
        await tx.execute('SYNC 1')
        await tx.execute('SYNC 2')
      }),
      db.transaction(async (tx) => {
        await tx.execute('WRITE 1')
      }),
      db.execute('OUTSIDE'),
    ])

    expect(log).toEqual([
      'BEGIN',
      'SYNC 1',
      'SYNC 2',
      'COMMIT',
      'BEGIN',
      'WRITE 1',
      'COMMIT',
      'OUTSIDE',
    ])
  })

  it('turns the plugin’s string rejections into Errors with the message', async () => {
    const db = await openTauriDatabase()
    await expect(db.execute('FAIL')).rejects.toThrow(/no such table: nope/)
    await expect(db.execute('FAIL')).rejects.toBeInstanceOf(Error)
  })

  it('rolls back and keeps working after a transaction fails', async () => {
    log.length = 0
    const db = await openTauriDatabase()
    await expect(
      db.transaction(async (tx) => {
        await tx.execute('FAIL')
      }),
    ).rejects.toThrow(/no such table/)
    await db.execute('AFTER')
    expect(log).toEqual(['BEGIN', 'FAIL', 'ROLLBACK', 'AFTER'])
  })
})
