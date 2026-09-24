import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SetPasswordForm } from '../../components/SetPasswordForm'

/**
 * Where invitation and password-reset emails land (FR-1.5, FR-1.6). The app is
 * a desktop and Android build with no URL of its own, so the email links here
 * and this page finishes the job. See docs/auth-setup.md section 3.
 *
 * It is for staff holding an emailed link, not for visitors, so it is kept out
 * of search results and out of the sitemap.
 */
export const metadata: Metadata = {
  title: 'Set your password',
  robots: { index: false, follow: false },
}

export default function ResetPasswordPage() {
  return (
    <section className="rw-container rw-section" style={{ paddingTop: '9rem' }}>
      {/* The form reads the link's query string, which a static export only
          has in the browser; Next requires the boundary for that. */}
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </section>
  )
}
