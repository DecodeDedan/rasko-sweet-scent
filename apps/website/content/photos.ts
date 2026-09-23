/**
 * GENERATED FILE. Do not edit.
 *
 * Written by scripts/build-photos.mjs from photos.manifest.json.
 * To change a photograph or its alt text, edit the manifest and re-run:
 *   pnpm --filter @rasko/website photos
 */

export type Photo = {
  /** Basename of the exported files in /public/photos. */
  readonly name: string
  /** Describes what is in the frame, for people who cannot see it. */
  readonly alt: string
  /** Exported widths, ascending. Used to build the srcset. */
  readonly widths: readonly number[]
  /** Intrinsic size of the original, so the browser can reserve the space. */
  readonly width: number
  readonly height: number
  /**
   * Set only on licensed reference photography that the farm did not shoot.
   * Null on the farm's own originals. Any component rendering a photo with a
   * credit must display it: that is the licence condition, not a nicety.
   */
  readonly credit: {
    readonly license: string
    readonly artist: string
    readonly url: string
  } | null
}

export const photos = {
  'field-silver-sky': {
    name: 'field-silver-sky',
    alt: 'A silver-blue eucalyptus growing in an open field bed, its branches reaching across a bright sky.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'variety-silver': {
    name: 'variety-silver',
    alt: 'Dense silver-blue eucalyptus foliage, the round leaves set in opposite pairs along every stem.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'variety-pink': {
    name: 'variety-pink',
    alt: 'A eucalyptus bush carrying pink and bronze new growth at the tips of its green leaves.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'field-silver-row': {
    name: 'field-silver-row',
    alt: 'A young eucalyptus plant in a field bed of red soil, with further rows running away behind it.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'cut-stems': {
    name: 'cut-stems',
    alt: 'Freshly cut eucalyptus stems laid against a timber wall, cut ends turned to face the same way.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  sorting: {
    name: 'sorting',
    alt: 'Cut eucalyptus being sorted into bunches on a bench, with the stem ends gathered and aligned.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'bunch-tied': {
    name: 'bunch-tied',
    alt: 'A tied bunch of eucalyptus resting on card, its stems trimmed level across the base.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'shed-rows': {
    name: 'shed-rows',
    alt: 'Cut eucalyptus held in quantity inside the packing shed, banked in rows against a timber wall.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
  'shed-wide': {
    name: 'shed-wide',
    alt: 'The packing shed seen wide, filled with cut eucalyptus waiting to be graded and tied.',
    credit: null,
    widths: [640, 960, 1280],
    width: 1600,
    height: 1200,
  },
  'stem-single': {
    name: 'stem-single',
    alt: 'One eucalyptus stem laid out flat, showing the full length and the regular pairing of its leaves.',
    credit: null,
    widths: [640, 960, 1200],
    width: 1200,
    height: 1600,
  },
} as const satisfies Record<string, Photo>

export type PhotoName = keyof typeof photos
