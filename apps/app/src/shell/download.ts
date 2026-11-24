/**
 * FR-2.7. A Blob download is the whole feature: no library, works offline.
 * The byte-order mark makes Excel read the file as UTF-8, so "Kahawa Sukari"
 * and "KES 1,000.00" survive the round trip.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
