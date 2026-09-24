'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

import { BrandMark } from '../../shell/BrandMark.js'

/**
 * The signed-out frame: the brand on Rasko Green beside the form on white.
 * Shared by sign-in and the first-login password screen, so the first thing
 * an invited member of staff sees is the company, not a bare form.
 *
 * Motion is Framer's `initial`, written at runtime: with no script the panel is
 * simply there, and reduced motion skips it.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const isReduced = useReducedMotion()
  const rise = (delay: number) =>
    isReduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const },
        }

  return (
    <div className="auth-screen">
      <aside className="auth-panel" aria-hidden="true">
        <motion.div className="auth-panel__mark" {...rise(0)}>
          <BrandMark height={132} isReversed />
        </motion.div>
        <motion.p className="auth-panel__slogan" {...rise(0.12)}>
          All that nature gives.
        </motion.p>
        <motion.p className="auth-panel__line" {...rise(0.2)}>
          Cut eucalyptus foliage, grown in Molo for the trade.
        </motion.p>
        <p className="auth-panel__foot">Rasko Sweet Scent · Nakuru County</p>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  )
}
