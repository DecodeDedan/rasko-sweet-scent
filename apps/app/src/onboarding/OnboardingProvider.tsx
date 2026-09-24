'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@rasko/ui'

import { useAuth } from '../auth/AuthProvider.js'
import type { ModuleId } from '../shell/navigation.js'
import { hasSeenTour, markTourSeen, tourSteps } from './tour.js'
import type { TourStep } from './tour.js'

interface OnboardingValue {
  startTour: () => void
}

const OnboardingContext = createContext<OnboardingValue | null>(null)

export function useOnboarding(): OnboardingValue {
  const value = useContext(OnboardingContext)
  if (!value) throw new Error('useOnboarding must be used inside OnboardingProvider.')
  return value
}

/** Time for the shell to paint before the first step measures anything. */
const AUTO_START_DELAY_MS = 700
const CARD_WIDTH = 320
const GAP = 14
const SPOT_PADDING = 6

/**
 * The first-run tour, shown once per user per device and on demand from the
 * help button. Anchored steps spotlight the real control (a dimmed page with
 * the target left clear) and put the explanation beside it; the opening and
 * closing steps are centre dialogs.
 */
export function OnboardingProvider({
  modules,
  children,
}: {
  modules: readonly ModuleId[]
  children: ReactNode
}) {
  const { identity } = useAuth()
  const [index, setIndex] = useState<number | null>(null)

  const steps = useMemo(
    () =>
      identity
        ? tourSteps({
            firstName: identity.fullName.split(' ')[0] || identity.fullName,
            role: identity.role,
            modules,
          })
        : [],
    [identity, modules],
  )

  useEffect(() => {
    if (!identity || identity.mustChangePassword || hasSeenTour(identity.userId)) return
    const timer = setTimeout(() => setIndex(0), AUTO_START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [identity])

  const finish = useCallback(() => {
    if (identity) markTourSeen(identity.userId)
    setIndex(null)
  }, [identity])

  const value = useMemo(() => ({ startTour: () => setIndex(0) }), [])
  const step = index === null ? null : (steps[index] ?? null)

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {step && index !== null ? (
        <TourStepView
          step={step}
          index={index}
          total={steps.length}
          onBack={() => setIndex(Math.max(0, index - 1))}
          onNext={() => (index + 1 >= steps.length ? finish() : setIndex(index + 1))}
          onSkip={finish}
        />
      ) : null}
    </OnboardingContext.Provider>
  )
}

interface StepViewProps {
  step: TourStep
  index: number
  total: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
}

function TourStepView(props: StepViewProps) {
  const target = useTarget(props.step.target)
  return target ? <Coachmark {...props} target={target} /> : <CentreStep {...props} />
}

function CentreStep({ step, index, total, onBack, onNext, onSkip }: StepViewProps) {
  const isLast = index + 1 >= total
  return (
    <Modal
      isOpen
      size="sm"
      onClose={onSkip}
      title={step.title}
      className="tour-modal"
      footer={
        <>
          {index === 0 ? (
            <Button variant="ghost" onClick={onSkip}>
              Not now
            </Button>
          ) : (
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={onNext}>
            {index === 0 ? 'Show me around' : isLast ? 'Start working' : 'Next'}
          </Button>
        </>
      }
    >
      <p className="tour-modal__body">{step.body}</p>
      {index === 0 ? (
        <p className="tour-modal__meta">{total - 2} short stops. Esc skips at any time.</p>
      ) : null}
    </Modal>
  )
}

/** The visible element for an anchor: a module can be in the sidebar or the bottom bar. */
function useTarget(name: string | undefined): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!name) {
      setElement(null)
      return
    }
    const found = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)).find(
      (candidate) => candidate.getClientRects().length > 0,
    )
    found?.scrollIntoView({ block: 'nearest' })
    setElement(found ?? null)
  }, [name])
  return element
}

function useRect(element: HTMLElement): DOMRect {
  const [rect, setRect] = useState(() => element.getBoundingClientRect())
  useLayoutEffect(() => {
    const update = () => setRect(element.getBoundingClientRect())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [element])
  return rect
}

function place(rect: DOMRect, cardHeight: number): { x: number; y: number } {
  const clampY = (y: number) => Math.min(Math.max(GAP, y), window.innerHeight - cardHeight - GAP)
  const clampX = (x: number) => Math.min(Math.max(GAP, x), window.innerWidth - CARD_WIDTH - GAP)
  // Sidebar anchors: to the right. Anything else: above if it fits, else below.
  if (rect.right + GAP + CARD_WIDTH < window.innerWidth && rect.left < window.innerWidth / 3) {
    return { x: rect.right + GAP, y: clampY(rect.top + rect.height / 2 - cardHeight / 2) }
  }
  const x = clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2)
  return rect.top - GAP - cardHeight > GAP
    ? { x, y: rect.top - GAP - cardHeight }
    : { x, y: clampY(rect.bottom + GAP) }
}

function Coachmark({
  step,
  index,
  total,
  onBack,
  onNext,
  onSkip,
  target,
}: StepViewProps & { target: HTMLElement }) {
  const rect = useRect(target)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(180)
  const isReduced = useReducedMotion()

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
    cardRef.current?.focus()
  }, [step.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip()
      if (event.key === 'ArrowRight') onNext()
      if (event.key === 'ArrowLeft' && index > 0) onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, onBack, onNext, onSkip])

  const position = place(rect, cardHeight)
  const move = isReduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 380, damping: 36 }

  return (
    <div className="tour-layer">
      {/* The spotlight: one fixed box over the target whose outer shadow is the
          scrim, so everything but the control dims. It is not a click target;
          the tour is driven from its own card. */}
      <motion.div
        className="tour-spotlight"
        initial={false}
        animate={{ x: rect.left - SPOT_PADDING, y: rect.top - SPOT_PADDING }}
        transition={move}
        style={{ width: rect.width + SPOT_PADDING * 2, height: rect.height + SPOT_PADDING * 2 }}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          className="tour-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`tour-${step.id}-title`}
          aria-describedby={`tour-${step.id}-body`}
          tabIndex={-1}
          style={{ width: CARD_WIDTH }}
          initial={isReduced ? false : { opacity: 0, x: position.x, y: position.y + 6 }}
          animate={{ opacity: 1, x: position.x, y: position.y }}
          exit={isReduced ? { opacity: 1 } : { opacity: 0 }}
          transition={isReduced ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        >
          <p className="tour-card__count">
            {index} of {total - 2}
          </p>
          <h2 id={`tour-${step.id}-title`} className="tour-card__title">
            {step.title}
          </h2>
          <p id={`tour-${step.id}-body`} className="tour-card__body">
            {step.body}
          </p>
          <div className="tour-card__actions">
            <button type="button" className="tour-card__skip" onClick={onSkip}>
              Skip tour
            </button>
            <div className="rsk-row">
              <Button size="sm" onClick={onBack}>
                Back
              </Button>
              <Button size="sm" variant="primary" onClick={onNext}>
                Next
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
