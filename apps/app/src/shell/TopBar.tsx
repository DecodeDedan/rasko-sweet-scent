import { SyncStatus } from './SyncStatus.js'
import { UserMenu } from './UserMenu.js'

export interface TopBarProps {
  title: string
}

export function TopBar({ title }: TopBarProps) {
  return (
    <header className="shell__topbar">
      {/* The sidebar already names the module on desktop; this is the mobile title. */}
      <p className="shell__topbar-title">{title}</p>

      <div className="shell__topbar-right">
        <SyncStatus />
        <UserMenu />
      </div>
    </header>
  )
}
