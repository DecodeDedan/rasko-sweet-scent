/**
 * @rasko/ui — shared design system for the Tauri app and the marketing website.
 *
 * Styles are imported separately so a consumer can pick its entry point:
 *   import '@rasko/ui/styles/all.css'         // fonts + tokens + base + components
 *   import '@rasko/ui/styles/tokens.css'      // tokens only
 *
 * Everything visual here is bound by docs/brand.md and PRD §7. No component
 * introduces a colour, font or size that is not a token.
 */

export { Button } from './components/Button.js'
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button.js'

export { Card } from './components/Card.js'
export type { CardProps } from './components/Card.js'

export { Drawer } from './components/Drawer.js'
export type { DrawerProps } from './components/Drawer.js'

export { EmptyState } from './components/EmptyState.js'
export type { EmptyStateProps } from './components/EmptyState.js'

export { Field, useFieldControl } from './components/Field.js'
export type { FieldProps } from './components/Field.js'

export { Input } from './components/Input.js'
export type { InputProps } from './components/Input.js'

export { Modal } from './components/Modal.js'
export type { ModalProps } from './components/Modal.js'

export { PageHeader } from './components/PageHeader.js'
export type { PageHeaderProps } from './components/PageHeader.js'

export { PasswordInput } from './components/PasswordInput.js'
export type { PasswordInputProps } from './components/PasswordInput.js'

export { Select } from './components/Select.js'
export type { SelectOption, SelectProps } from './components/Select.js'

export { StatusChip } from './components/StatusChip.js'
export type { StatusChipProps, StatusTone } from './components/StatusChip.js'

export { Textarea } from './components/Textarea.js'
export type { TextareaProps } from './components/Textarea.js'

export { Table } from './components/Table.js'
export type { TableColumn, TableProps } from './components/Table.js'

export { TabPanel, Tabs } from './components/Tabs.js'
export type { TabItem, TabPanelProps, TabsProps } from './components/Tabs.js'

export { Tooltip } from './components/Tooltip.js'
export type { TooltipProps } from './components/Tooltip.js'

export { ToastProvider, useToast } from './components/Toast.js'
export type { ToastInput, ToastTone } from './components/Toast.js'

export { cx } from './utils/cx.js'
export {
  formatDate,
  formatDateTime,
  formatKes,
  formatPhone,
  formatQuantity,
} from './utils/format.js'

export { color, font, fontSize, fontWeight, radius, space } from './tokens.js'
export type { Color, FontSize, Space } from './tokens.js'
