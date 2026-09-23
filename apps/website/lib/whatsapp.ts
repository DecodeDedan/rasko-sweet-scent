/**
 * The site's single call to action.
 *
 * wa.me is WhatsApp's own click-to-chat endpoint. It needs the number in
 * international format with no plus sign, no spaces and no leading zero, which
 * is a rule people get wrong often enough to be worth asserting rather than
 * trusting. A malformed number fails silently: WhatsApp opens on a "phone
 * number shared via a link is not on WhatsApp" screen and the enquiry is lost.
 */

/** Matches a bare international number: country code plus subscriber digits. */
const E164_DIGITS = /^[1-9]\d{7,14}$/

export function isValidWhatsappNumber(number: string): boolean {
  return E164_DIGITS.test(number)
}

/**
 * Builds a click-to-chat URL, or returns null when there is no usable number.
 *
 * Returning null rather than throwing lets the Enquiry section render a clearly
 * inert button during development instead of crashing the page. The build is
 * the thing that refuses to ship without a number, not the component.
 */
export function whatsappLink(number: string | null, prefill?: string): string | null {
  if (number === null || !isValidWhatsappNumber(number)) return null

  const url = new URL(`https://wa.me/${number}`)
  if (prefill) url.searchParams.set('text', prefill)
  return url.toString()
}
