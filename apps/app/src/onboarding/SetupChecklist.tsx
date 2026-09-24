'use client'

import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button, Card, Tooltip } from '@rasko/ui'

import { useIdentity } from '../auth/AuthProvider.js'
import type { Role } from '../auth/session.js'
import { useSync } from '../data/sync/SyncProvider.js'
import { useSyncedEffect } from '../data/sync/useSyncedEffect.js'
import { useShellNavigate } from '../shell/ShellNavigation.js'
import { readSetupFacts, setupItems } from './setup.js'
import type { SetupItem } from './setup.js'

const dismissKey = (userId: string) => `rasko.setup.dismissed.${userId}`

function isDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(userId)) !== null
  } catch {
    return false
  }
}

/**
 * "Set up the business", on the dashboard for the owner and manager until
 * every item is done. Each row opens the place to do it.
 */
export function SetupChecklist({ role }: { role: Role }) {
  const { db } = useSync()
  const identity = useIdentity()
  const navigate = useShellNavigate()
  const [items, setItems] = useState<SetupItem[] | null>(null)
  const [isHidden, setIsHidden] = useState(() => isDismissed(identity.userId))

  const load = useCallback(async () => {
    if (!db) return
    setItems(setupItems(await readSetupFacts(db), role))
  }, [db, role])
  useSyncedEffect(load)

  if (role !== 'owner' && role !== 'manager') return null
  if (isHidden || !items) return null
  const done = items.filter((item) => item.isDone).length
  if (done === items.length) return null

  function dismiss() {
    try {
      window.localStorage.setItem(dismissKey(identity.userId), new Date().toISOString())
    } catch {
      // Storage blocked: it hides for this session only.
    }
    setIsHidden(true)
  }

  return (
    <Card className="setup">
      <div className="setup__head">
        <div>
          <p className="setup__eyebrow">Getting started</p>
          <h2 className="setup__title">Set up the business</h2>
          <p className="setup__meta">
            {done} of {items.length} done
          </p>
        </div>
        <Tooltip label="Hide this list" placement="bottom">
          <button
            type="button"
            className="rsk-icon-btn"
            aria-label="Hide the setup list"
            onClick={dismiss}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div
        className="setup__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
        aria-label="Setup progress"
      >
        <motion.span
          className="setup__fill"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: done / items.length }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <ol className="setup__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={item.isDone ? 'setup__item setup__item--done' : 'setup__item'}
          >
            <span className="setup__tick" aria-hidden="true">
              {item.isDone ? <Check size={14} /> : null}
            </span>
            <div className="setup__text">
              <p className="setup__label">
                {item.label}
                {item.isDone ? <span className="rsk-visually-hidden"> (done)</span> : null}
              </p>
              {item.isDone ? null : <p className="setup__detail">{item.detail}</p>}
            </div>
            {item.isDone ? null : (
              <Button size="sm" onClick={() => navigate(item.module)}>
                {item.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
