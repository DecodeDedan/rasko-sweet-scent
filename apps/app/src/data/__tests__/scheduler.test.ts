import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openNodeDatabase } from '../sqlite/nodeDatabase.js'
import { migrateLocalSchema } from '../sqlite/schema.js'
import type { SqlDatabase } from '../sqlite/types.js'
import { Repository } from '../repositories/repository.js'
import { DEBOUNCE_MS, INTERVAL_MS, SyncScheduler } from '../sync/scheduler.js'
import type { SchedulerEvent } from '../sync/scheduler.js'
import { MockServer } from './mockServer.js'

/** NFR-S3: launch, debounced post-write, five-minute interval, reconnect, manual. */
describe('sync triggers', () => {
  let db: SqlDatabase
  let server: MockServer
  let events: SchedulerEvent[]
  let scheduler: SyncScheduler

  beforeEach(async () => {
    vi.useFakeTimers()
    db = openNodeDatabase()
    await migrateLocalSchema(db)
    server = new MockServer()
    events = []
    scheduler = new SyncScheduler(db, server.remoteFor('user'), {
      onEvent: (event) => events.push(event),
    })
  })

  afterEach(async () => {
    scheduler.stop()
    vi.useRealTimers()
    await db.close()
  })

  it('syncs on launch', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    expect(events.map((e) => e.trigger)).toContain('launch')
  })

  it('debounces writes into a single sync', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    events.length = 0

    for (let index = 0; index < 10; index += 1) scheduler.notifyLocalWrite()

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(events).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2)
    expect(events.filter((e) => e.trigger === 'write')).toHaveLength(1)
  })

  it('syncs every five minutes while open', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    events.length = 0

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(events.filter((e) => e.trigger === 'interval')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(events.filter((e) => e.trigger === 'interval')).toHaveLength(2)
  })

  it('syncs when connectivity is regained', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    events.length = 0

    window.dispatchEvent(new Event('online'))
    await vi.runOnlyPendingTimersAsync()

    expect(events.filter((e) => e.trigger === 'reconnect')).toHaveLength(1)
  })

  it('syncs on demand', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    events.length = 0

    await scheduler.syncNow()
    expect(events.filter((e) => e.trigger === 'manual')).toHaveLength(1)
  })

  it('stops every trigger once stopped (NFR-S7: only while open)', async () => {
    scheduler.start()
    await vi.runOnlyPendingTimersAsync()
    scheduler.stop()
    events.length = 0

    scheduler.notifyLocalWrite()
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)

    expect(events).toHaveLength(0)
  })

  it('never runs two cycles at once', async () => {
    // Overlapping triggers are routine — a write finishing as the interval
    // fires. Two concurrent cycles would interleave push and pull.
    let concurrent = 0
    let maxConcurrent = 0
    const remote = server.remoteFor('user')
    const slow = {
      pull: async (...args: Parameters<typeof remote.pull>) => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await Promise.resolve()
        concurrent -= 1
        return remote.pull(...args)
      },
      push: remote.push,
    }

    const overlapping = new SyncScheduler(db, slow, { onEvent: (e) => events.push(e) })
    overlapping.start()
    void overlapping.syncNow()
    void overlapping.syncNow()
    void overlapping.syncNow()
    await vi.runOnlyPendingTimersAsync()

    expect(maxConcurrent).toBe(1)
    overlapping.stop()
  })

  it('reports the queue depth the indicator shows', async () => {
    const repo = new Repository(db, 'orders', { userId: 'user' })
    server.setOffline(true)
    await repo.insert({ id: 'aaaaaaaa-0000-4000-8000-000000000001', status: 'draft' })
    await repo.insert({ id: 'aaaaaaaa-0000-4000-8000-000000000002', status: 'draft' })

    scheduler.start()
    await vi.runOnlyPendingTimersAsync()

    expect(events.at(-1)?.pending).toBe(2)
  })
})
