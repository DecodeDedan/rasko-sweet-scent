import type { SqlDatabase } from '../sqlite/types.js'
import { runSync } from './engine.js'
import type { SyncOptions, SyncOutcome } from './engine.js'
import { pendingCount } from './outbox.js'
import type { SyncRemote } from './remote.js'

/**
 * The NFR-S3 triggers: launch, debounced after every local write, every five
 * minutes while open, on connectivity regained, and manual.
 *
 * NFR-S7: only while the app is open. There is no background service on either
 * platform, which is an accepted Tauri mobile constraint — these triggers are
 * what makes that sufficient at this scale.
 */

export const DEBOUNCE_MS = 2_000
export const INTERVAL_MS = 5 * 60_000

export type SyncTrigger = 'launch' | 'write' | 'interval' | 'reconnect' | 'manual'

export interface SchedulerEvent {
  trigger: SyncTrigger
  outcome: SyncOutcome
  pending: number
}

export interface SchedulerOptions extends SyncOptions {
  debounceMs?: number
  intervalMs?: number
  onEvent?: (event: SchedulerEvent) => void
  /** Called when the server refuses this device, so the app can re-check identity (T4). */
  onAuthFailure?: () => void
}

export class SyncScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  /** A trigger that arrived mid-run; coalesced into one follow-up cycle. */
  private queued: SyncTrigger | null = null
  private stopped = true

  constructor(
    private readonly db: SqlDatabase,
    private readonly remote: SyncRemote,
    private readonly options: SchedulerOptions = {},
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false

    this.interval = setInterval(
      () => void this.run('interval'),
      this.options.intervalMs ?? INTERVAL_MS,
    )

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
    }

    void this.run('launch')
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.interval) clearInterval(this.interval)
    this.timer = null
    this.interval = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
    }
  }

  private readonly handleOnline = () => {
    void this.run('reconnect')
  }

  /**
   * Called by every repository write. Debounced so that typing a ten-line order
   * produces one sync, not ten.
   */
  notifyLocalWrite(): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run('write')
    }, this.options.debounceMs ?? DEBOUNCE_MS)
  }

  syncNow(): Promise<void> {
    return this.run('manual')
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * Single-flight. Overlapping triggers are common — a write finishing just as
   * the five-minute timer fires — and two concurrent cycles would interleave
   * push and pull, letting a pull overwrite a row whose push was still in
   * flight.
   */
  private async run(trigger: SyncTrigger): Promise<void> {
    if (this.stopped && trigger !== 'manual') return

    if (this.running) {
      this.queued = trigger
      return
    }

    this.running = true
    try {
      const outcome = await runSync(this.db, this.remote, this.options)
      const pending = await pendingCount(this.db)
      this.options.onEvent?.({ trigger, outcome, pending })
      if (outcome.authFailed) this.options.onAuthFailure?.()
    } finally {
      this.running = false
    }

    const next = this.queued
    this.queued = null
    if (next) await this.run(next)
  }
}
