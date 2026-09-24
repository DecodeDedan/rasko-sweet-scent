import { CircleHelp } from 'lucide-react'
import { Tooltip } from '@rasko/ui'

import { useOnboarding } from '../onboarding/OnboardingProvider.js'
import { SyncStatus } from './SyncStatus.js'
import { UserMenu } from './UserMenu.js'

export interface TopBarProps {
  title: string
}

export function TopBar({ title }: TopBarProps) {
  const { startTour } = useOnboarding()

  return (
    <header className="shell__topbar">
      {/* The sidebar already names the module on desktop; this is the mobile title. */}
      <p className="shell__topbar-title">{title}</p>

      <div className="shell__topbar-right">
        <span data-tour="sync" className="shell__topbar-anchor">
          <SyncStatus />
        </span>
        <Tooltip label="Take the tour" placement="bottom">
          <button
            type="button"
            className="rsk-icon-btn shell__help"
            data-tour="help"
            aria-label="Help: take the tour"
            onClick={startTour}
          >
            <CircleHelp size={18} aria-hidden="true" />
          </button>
        </Tooltip>
        <UserMenu />
      </div>
    </header>
  )
}
