// Types for compose.js, so the app (TypeScript, Vite) can import the same
// composer the send-email function uses and preview a template exactly as a
// client will receive it. Deno reads the JSDoc in compose.js instead.
export interface EmailCompany {
  company_name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  kra_pin?: string | null
  mpesa_paybill?: string | null
  mpesa_till?: string | null
  bank_details?: Record<string, string> | null
}

export interface EmailTemplateText {
  subject: string
  heading: string
  body: string
}

export interface EmailFacts {
  vars: Record<string, string | number | null | undefined>
  blocksHtml?: string
  personalNote?: string | null
  company: EmailCompany
  senderName?: string | null
  assetBaseUrl: string
  /** Overrides the hosted logo URL, e.g. a data URI for an in-app preview. */
  logoSrc?: string
}

export function composeEmail(
  template: EmailTemplateText,
  facts: EmailFacts,
): { subject: string; html: string; text: string }
