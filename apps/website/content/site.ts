/**
 * Every business fact the website states, in one file.
 *
 * WHY THIS FILE EXISTS
 * The site is a trade page. A florist reading it wants stem lengths, bunch
 * counts, lead times and a phone number, and a wrong figure here is worse than
 * a missing one: it produces an order that cannot be filled. So no component
 * anywhere in this site contains a business fact. They all read from here.
 *
 * HOW TO FILL IT IN
 * A fact we do not have yet is `null`. That is deliberate and it is enforced:
 *
 *   - Components omit a null field completely. Nothing renders a placeholder,
 *     so a visitor never reads "TBD" and never reads an invented number.
 *   - `scripts/check-content.mjs` lists what is still null, and fails the build
 *     if one of the REQUIRED facts is missing. Run `pnpm content` to see the
 *     outstanding list at any time.
 *
 * Replace a null with the real value once the client confirms it. Nothing else
 * needs to change: the layout already has a place for every field.
 *
 * This follows the repository rule in CLAUDE.md for unanswered client
 * questions: never invent a value silently, never bury one in code. The
 * corresponding open items are PRD section 12 questions 1 and 2.
 */

import type { PhotoName } from './photos'

/** A fact awaiting confirmation from the client. Rendered as nothing. */
export type Fact<T> = T | null

export type Variety = {
  /**
   * What we call it on the page. These two names describe what is visible in
   * the photographs rather than asserting a cultivar, because the cultivar has
   * not been confirmed. Once `tradeName` is filled in, it takes over.
   */
  readonly label: string
  /** The name the trade buys it under, e.g. "Baby Blue". */
  readonly tradeName: Fact<string>
  /** e.g. "Eucalyptus pulverulenta". Set italic by the Varieties section. */
  readonly botanicalName: Fact<string>
  readonly photo: PhotoName
  /** Describes the plant. Safe to write from the photographs. */
  readonly description: string
  /** Specification rows. A null value drops its row from the table. */
  readonly spec: {
    /** e.g. "50 to 70 cm" */
    readonly stemLength: Fact<string>
    /** e.g. "10 stems" */
    readonly bunchSize: Fact<string>
    /** e.g. "14 to 21 days" */
    readonly vaseLife: Fact<string>
    /** e.g. "Year round" or "March to October" */
    readonly availability: Fact<string>
  }
}

export const site = {
  name: 'Rasko Sweet Scent',

  /** Confirmed by the project owner, 2026-09-24. */
  slogan: 'All that nature gives.',

  /**
   * The site's public address, e.g. 'https://raskosweetscent.co.ke', with no
   * trailing slash. Not yet confirmed. While null, the build omits
   * everything that needs an absolute URL: the canonical link, the sitemap
   * entries, the share image and the JSON-LD `url` / `logo`. The page still
   * indexes without them; with them it indexes faster and previews properly.
   */
  url: null as Fact<string>,

  /**
   * What a search result shows. The title leads with the brand, because a
   * search for the name must land here; the description carries the terms a
   * trade buyer types: Baby Blue, eucalyptus, foliage, Molo, Nakuru, Kenya.
   */
  seo: {
    title: 'Rasko Sweet Scent | Baby Blue Eucalyptus Foliage, Kenya',
    description:
      'Rasko Sweet Scent grows Baby Blue, Gunni, Parvifolia and Globulus eucalyptus in Molo, Nakuru County, and supplies fresh-cut foliage to florists and floral decorators in Kenya.',
    /** What the business knows about, for the structured data. */
    topics: [
      'Eucalyptus',
      'Baby Blue eucalyptus',
      'Eucalyptus pulverulenta',
      'Eucalyptus gunnii',
      'Eucalyptus parvifolia',
      'Eucalyptus globulus',
      'Cut foliage',
      'Floral greenery',
    ],
  },

  /** Used for the page title and the meta description. */
  summary:
    'A eucalyptus farm in Nakuru, Kenya, supplying fresh-cut foliage to florists, decorators and wholesalers.',

  hero: {
    headline: 'Eucalyptus foliage, cut and graded by experts.',
    standfirst:
      'We grow it ourselves in Molo, Nakuru County, sort it by hand, and tie it into bunches before it leaves the farm. Tell us what you need and the day you need it.',
    photo: 'field-silver-sky',
  },

  varieties: {
    heading: 'What we grow',
    // Four varieties, confirmed by the project owner 2026-09-24 with a named
    // photograph of each. Descriptions state only what those photographs show.
    intro: 'Four eucalyptus varieties, all grown in open field beds.',
    items: [
      {
        label: 'Silver-blue eucalyptus',
        // Baby Blue is the specialty of the farm (project owner, 2026-09-23).
        tradeName: 'Baby Blue',
        botanicalName: 'Eucalyptus pulverulenta',
        photo: 'variety-silver',
        description:
          'Round leaves in close opposite pairs, matt silver over blue-green, running the whole length of the stem. It keeps much of its colour and its scent as it dries.',
        spec: {
          stemLength: null,
          bunchSize: null,
          vaseLife: null,
          availability: null,
        },
      },
      {
        label: 'Long-leaf eucalyptus',
        tradeName: 'Gunni',
        botanicalName: 'Eucalyptus gunnii',
        photo: 'variety-gunni',
        description:
          'Long, narrow green leaves on slender stems, with copper and orange new growth at the tips.',
        spec: {
          stemLength: null,
          bunchSize: null,
          vaseLife: null,
          availability: null,
        },
      },
      {
        label: 'Small-leaf eucalyptus',
        tradeName: 'Parvifolia',
        botanicalName: 'Eucalyptus parvifolia',
        photo: 'variety-parvifolia',
        description:
          'Small, pointed blue-green leaves set closely along fine, branching stems. A light, airy filler.',
        spec: {
          stemLength: null,
          bunchSize: null,
          vaseLife: null,
          availability: null,
        },
      },
      {
        label: 'Broad-leaf eucalyptus',
        tradeName: 'Globulus',
        botanicalName: 'Eucalyptus globulus',
        photo: 'variety-globulus',
        description:
          'Broad, rounded green leaves on red stems, the new growth coming through bronze and red.',
        spec: {
          stemLength: null,
          bunchSize: null,
          vaseLife: null,
          availability: null,
        },
      },
    ] satisfies readonly Variety[],
  },

  /**
   * A genuine sequence, which is the only reason the steps carry numbers.
   * Every line here describes something visible in the photograph beside it.
   */
  process: {
    heading: 'How an order is filled',
    steps: [
      {
        title: 'Cut',
        body: 'Stems are cut from the field beds by hand and carried in to the shed.',
        photo: 'cut-stems',
      },
      {
        title: 'Sort',
        body: 'Every stem is sorted by its length and by the condition of its leaf.',
        photo: 'sorting',
      },
      {
        title: 'Tie',
        body: 'Sorted stems are gathered into bunches and the ends trimmed level.',
        photo: 'bunch-tied',
      },
      {
        title: 'Hold',
        body: 'Bunches are kept in the packing shed until the day they are dispatched.',
        photo: 'shed-rows',
      },
    ],
  },

  farm: {
    heading: 'The farm',
    body: [
      'The eucalyptus grows outdoors in red-soil field beds, not under glass. Plants are cut back and left to regrow, so the same beds carry one crop after another.',
      'Cutting, sorting and tying all happen on site. Nothing is bought in and passed on.',
    ],
    photo: 'shed-wide',
    /**
     * The figures a buyer assessing capacity would ask for. Each renders as a
     * large tabular-numeral figure when set, and disappears when null.
     */
    figures: {
      /** e.g. { value: '1,200', unit: 'bunches a week' } */
      weeklyOutput: null as Fact<{ value: string; unit: string }>,
      plantedArea: null as Fact<{ value: string; unit: string }>,
      cuttingDays: null as Fact<{ value: string; unit: string }>,
    },
  },

  /**
   * The pinned 3D study of the lead variety. Each note describes the plant
   * itself, restating what the variety description already says, so the
   * section makes no claim about the business.
   */
  study: {
    eyebrow: 'The variety we are known for',
    notes: [
      {
        title: 'Round leaves, in pairs',
        body: 'The leaves grow in close opposite pairs, one either side of the stem, from the base to the tip.',
      },
      {
        title: 'Each pair turns a quarter',
        body: 'Every pair sits at a right angle to the one below it, which is why a stem looks full from any side.',
      },
      {
        title: 'Silver over blue-green',
        body: 'A matt, powdery finish over blue-green. It keeps much of its colour and its scent as it dries.',
      },
    ],
  },

  enquiry: {
    heading: 'Send an enquiry',
    body: 'Tell us what you need and we will come back to you on availability and price.',
    /** What a useful first message contains. This is real trade guidance. */
    checklist: ['How many bunches', 'The date you need them', 'Where they are going'],
    /**
     * Pre-filled into the WhatsApp composer so the buyer starts mid-task.
     *
     * DEFERRED, 2026-09-12. A plain greeting is in use. The alternative is a
     * template carrying the checklist above as blank lines, so enquiries arrive
     * already structured. That trades two round trips per enquiry against the
     * people who see a form to fill in and close it instead. Which way that
     * falls depends on how Rasko's buyers actually behave, so it is the
     * client's call and it is not being guessed at here. Revisit with them.
     */
    prefill: 'Hello Rasko Sweet Scent. I would like to enquire about eucalyptus foliage.',
    /**
     * Trade terms. Every one of these renders as a row and vanishes when null,
     * so the section degrades to the checklist alone until they are confirmed.
     */
    terms: {
      minimumOrder: null as Fact<string>,
      leadTime: null as Fact<string>,
      delivery: null as Fact<string>,
      packing: null as Fact<string>,
      payment: null as Fact<string>,
    },
  },

  location: {
    town: 'Nakuru',
    country: 'Kenya',
    /**
     * Street or area. Shown in the footer under the town. Molo confirmed by
     * the project owner, 2026-09-24.
     */
    area: 'Molo' as Fact<string>,
    /** County, for the map card's address line. */
    county: 'Nakuru County',
    /**
     * The farm's pin, as latitude,longitude. Taken from the location the
     * project owner shared on Google Maps, 2026-09-24. A coordinate rather
     * than the shared link: that link is a person's live location and
     * expires, while the pin does not move.
     */
    mapQuery: '-0.3542512,35.6862408',
  },

  map: {
    heading: 'Where we grow',
    body: 'The farm is in the Molo area of Nakuru County, in the Kenyan highlands.',
  },

  contact: {
    /**
     * Optional. International format, digits only, no plus and no spaces.
     * Kenyan mobile 0712 345 678 becomes '254712345678'.
     * The WhatsApp action is omitted while this is null.
     */
    whatsapp: null as Fact<string>,
    /** Optional. How the same number is written for a human to read. */
    phoneDisplay: null as Fact<string>,
    email: null as Fact<string>,
    /** e.g. 'Monday to Saturday, 8am to 5pm' */
    hours: null as Fact<string>,
  },
} as const

/**
 * Facts that would block publishing if the site later needs a hard requirement.
 * Keep this list empty while contact details remain unconfirmed.
 *
 * Everything else is allowed to be missing: the page is designed to read
 * correctly without it.
 */
export const REQUIRED_FACTS = [] as const
