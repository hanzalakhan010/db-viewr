import { useState } from 'react'
import { copyToClipboard, downloadText, renderCell, toDelimited } from '@/lib/clipboard'

interface Props {
  columns: string[]
  rows: unknown[][]
  /** Basename for the CSV download, without the extension. */
  filename?: string
  /** Server capped the row list — say so instead of implying this is everything. */
  truncated?: boolean
  /** Hide the copy/download toolbar (per-statement grids in a script report). */
  showToolbar?: boolean
}

/**
 * The result grid shared by the query editor and each statement of a script
 * run, with client-side copy/export built from the already-fetched rows.
 */
export function ResultTable({
  columns,
  rows,
  filename = 'query-result',
  truncated = false,
  showToolbar = true,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  const flash = (label: string) => {
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const copy = async (sep: '\t' | ',', label: string) => {
    const ok = await copyToClipboard(toDelimited(columns, rows, sep))
    flash(ok ? label : 'Copy failed')
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {showToolbar && (
        <div className="flex items-center gap-2 border-b border-border-light px-3 py-1.5 text-xs">
          <button
            type="button"
            onClick={() => copy('\t', 'Copied TSV')}
            className="rounded border border-border px-2 py-0.5 text-text-secondary hover:border-accent hover:text-text"
          >
            Copy TSV
          </button>
          <button
            type="button"
            onClick={() => copy(',', 'Copied CSV')}
            className="rounded border border-border px-2 py-0.5 text-text-secondary hover:border-accent hover:text-text"
          >
            Copy CSV
          </button>
          <button
            type="button"
            onClick={() => {
              downloadText(`${filename}.csv`, toDelimited(columns, rows, ','), 'text/csv;charset=utf-8')
              flash('Downloaded')
            }}
            className="rounded border border-border px-2 py-0.5 text-text-secondary hover:border-accent hover:text-text"
          >
            Download CSV
          </button>
          {copied && <span className="text-success">✓ {copied}</span>}
        </div>
      )}
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-bg">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-border px-3 py-2 text-left font-mono text-xs text-text-secondary"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border-light hover:bg-border-light/40">
                {row.map((v, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1 font-mono text-xs">
                    {v === null ? <span className="text-muted italic">NULL</span> : renderCell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border-light px-3 py-1.5 text-xs text-text-secondary">
        {rows.length} row{rows.length === 1 ? '' : 's'}
        {truncated && <span className="text-accent"> · truncated to the first {rows.length}</span>}
      </div>
    </div>
  )
}
