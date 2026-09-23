/**
 * Brand tokens as values, for the places CSS custom properties cannot reach —
 * chart libraries, canvas, PDF generation, and the Tauri window background.
 *
 * This is a mirror of `styles/tokens.css`, which is itself a mirror of
 * `docs/brand.md`. docs/brand.md is the source of truth. Change it there first.
 *
 * The palette is locked to green / white / black and there is no accent colour.
 * If a chart needs more than one series colour, use tints and shades of Rasko
 * Green rather than introducing a new hue.
 */

export const color = {
  green: '#2D6A2F',
  greenHover: '#1F4D22',
  greenActive: '#16381A',
  greenTint: '#E9F2E7',
  greenTintBorder: '#CFE3CC',
  onGreen: '#FFFFFF',

  surface: '#FFFFFF',
  surfaceSubtle: '#F7F7F5',

  text: '#111111',
  textSecondary: '#5C5F58',
  border: '#E4E4E0',
  disabled: '#A3A69B',

  success: '#2D6A2F',
  warning: '#B45309',
  danger: '#B3261E',
} as const

export const font = {
  heading: "'Lora', Georgia, 'Times New Roman', serif",
  body: "'Manrope', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const

/** Type scale in px, per docs/brand.md. */
export const fontSize = {
  12: 12,
  13: 13,
  14: 14,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
} as const

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

/** 4px base step. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 48,
} as const

export const radius = {
  sm: 2,
  md: 4,
  lg: 8,
} as const

export type Color = keyof typeof color
export type FontSize = keyof typeof fontSize
export type Space = keyof typeof space
