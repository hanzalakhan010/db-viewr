/** Clipboard + download helpers, shared by the query grid and the OCR tool. */

/** Render one result cell the way the grid displays it. */
export function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function escapeCell(s: string, sep: string): string {
  // Quote only when needed — an unquoted TSV pastes into a spreadsheet cleanly.
  if (s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Serialise a result grid to CSV or TSV. NULL becomes an empty cell; objects
 * are JSON-stringified, matching what the table shows.
 */
export function toDelimited(
  columns: string[],
  rows: unknown[][],
  sep: '\t' | ',' = ',',
): string {
  const line = (cells: unknown[]) =>
    cells.map((c) => escapeCell(renderCell(c), sep)).join(sep)
  return [line(columns), ...rows.map(line)].join('\n')
}

/** Copy to the clipboard, returning false rather than throwing when denied. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Trigger a browser download of in-memory text. */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
