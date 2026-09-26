'use client'

import { formatMoney } from '@rasko/ui'

import type { TrendPoint } from './dashboardRepository.js'

/**
 * FR-2.2, drawn as inline SVG rather than with a charting library.
 *
 * A chart library would be ~50kB for one bar chart, and every one of them
 * ships a palette this brand does not permit. Bars are Rasko Green; the axis
 * and grid are the border neutral (docs/brand.md).
 */
export function SalesTrendChart({
  points,
  currency,
}: {
  points: readonly TrendPoint[]
  /** Every point is in this one currency; the repository never mixes them. */
  currency: string
}) {
  if (points.length === 0) return null

  const width = 720
  const height = 180
  const padding = { top: 12, right: 8, bottom: 24, left: 8 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const peak = Math.max(...points.map((point) => point.salesCents), 1)
  const barWidth = plotWidth / points.length
  const total = points.reduce((sum, point) => sum + point.salesCents, 0)

  // Label only the ends and the middle: 30 dates across this width is a smear.
  const labelled = new Set([0, Math.floor(points.length / 2), points.length - 1])

  return (
    <figure className="rsk-stack">
      <figcaption>
        <span className="rsk-numeric">{formatMoney(total, currency)}</span> over the last{' '}
        {points.length} days
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Daily sales for the last ${points.length} days, totalling ${formatMoney(total, currency)}. Highest day ${formatMoney(peak, currency)}.`}
        style={{ display: 'block', maxWidth: '100%' }}
      >
        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={padding.left + plotWidth}
          y2={padding.top + plotHeight}
          stroke="var(--rasko-border)"
          strokeWidth="1"
        />

        {points.map((point, index) => {
          const barHeight =
            point.salesCents === 0 ? 0 : Math.max(2, (point.salesCents / peak) * plotHeight)
          const x = padding.left + index * barWidth
          const y = padding.top + plotHeight - barHeight

          return (
            <g key={point.date}>
              <rect
                x={x + barWidth * 0.15}
                y={y}
                width={barWidth * 0.7}
                height={barHeight}
                fill="var(--rasko-green)"
              >
                <title>
                  {point.date}: {formatMoney(point.salesCents, currency)} across {point.orderCount}{' '}
                  orders
                </title>
              </rect>
              {labelled.has(index) ? (
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--rasko-text-secondary)"
                >
                  {point.date.slice(5)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
