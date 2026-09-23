/**
 * Shared motion constants.
 *
 * Three animation libraries drive this site and each takes easing in a
 * different form, so the curve is defined once here and converted at the point
 * of use. One curve everywhere is what makes a page feel like a single object
 * rather than a set of parts that each animate their own way.
 */

/** The entrance curve, as GSAP names it. */
export const ENTER_EASE = 'power3.out'

/** The same curve as a cubic bezier, for Framer Motion. */
export const ENTER_BEZIER: readonly [number, number, number, number] = [0.16, 1, 0.3, 1]

/**
 * Whether the visitor has asked the operating system for less movement.
 *
 * Guards against server-side execution, where `window` does not exist, so it
 * can be called from a module body without a mounted check.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
