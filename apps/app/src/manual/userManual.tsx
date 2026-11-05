import { BookOpen, Download } from 'lucide-react'
import { useMemo } from 'react'
import { Button, Card, PageHeader, useToast } from '@rasko/ui'

import type { ScreenProps } from '../screens/common.js'
import manualMarkdown from '../../../../docs/user-manual.md?raw'
import manualPdfUrl from './rasko-sweet-scent-user-manual.pdf?url'

const MANUAL_TITLE = 'Rasko Sweet Scent staff user manual'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`)
      list = []
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const headingMarks = heading[1] ?? ''
      const headingText = heading[2] ?? ''
      const level = Math.min(headingMarks.length + 1, 4)
      blocks.push(`<h${level}>${inlineMarkdown(headingText)}</h${level}>`)
      continue
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push('<hr />')
      continue
    }

    const nextLine = lines[index + 1]
    if (trimmed.startsWith('|') && nextLine !== undefined && isTableSeparator(nextLine)) {
      flushParagraph()
      flushList()
      const headers = tableCells(trimmed)
      index += 2
      const rows: string[] = []
      while (index < lines.length) {
        const rowLine = lines[index] ?? ''
        if (!rowLine.trim().startsWith('|')) break
        rows.push(
          `<tr>${tableCells(rowLine)
            .map((cell) => `<td>${inlineMarkdown(cell)}</td>`)
            .join('')}</tr>`,
        )
        index += 1
      }
      index -= 1
      blocks.push(
        `<div class="manual-table-wrap"><table><thead><tr>${headers
          .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      )
      continue
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks.join('\n')
}

export function ManualScreen({ scope }: ScreenProps) {
  const { showToast } = useToast()
  const content = useMemo(() => markdownToHtml(manualMarkdown), [])

  function downloadManual() {
    try {
      const link = document.createElement('a')
      link.href = manualPdfUrl
      link.download = 'rasko-sweet-scent-user-manual.pdf'
      link.target = '_blank'
      document.body.append(link)
      link.click()
      link.remove()
      showToast({ tone: 'success', title: 'Manual downloaded' })
    } catch (cause) {
      showToast({
        tone: 'danger',
        title: 'Could not download the manual',
        ...(cause instanceof Error ? { description: cause.message } : {}),
      })
    }
  }

  return (
    <div className="rsk-stack">
      <PageHeader
        title="User manual"
        description="A practical guide to the RSS Management System, available offline on this device."
        meta={<span className="manual-scope">{scope}</span>}
        actions={
          <Button variant="primary" onClick={downloadManual}>
            <Download size={16} aria-hidden="true" />
            Download manual
          </Button>
        }
      />
      <Card>
        <article className="manual-view">
          <header className="manual-view__header">
            <BookOpen size={22} aria-hidden="true" />
            <div>
              <h2>{MANUAL_TITLE}</h2>
              <p>Follow the sections that apply to your role.</p>
            </div>
          </header>
          <div
            className="manual-view__content"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        </article>
      </Card>
    </div>
  )
}
