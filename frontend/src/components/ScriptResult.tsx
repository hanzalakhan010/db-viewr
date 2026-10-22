import { useState } from 'react'
import type { ScriptRunResponse, ScriptStatementResult } from '@/lib/types'
import { ResultTable } from './ResultTable'

const STATUS_STYLE: Record<ScriptStatementResult['status'], string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
  skipped: 'border-border bg-border-light text-muted',
}

function StatementRow({ stmt }: { stmt: ScriptStatementResult }) {
  // Errors matter most, so those start open; everything else stays folded to
  // keep a 50-statement script scannable.
  const [open, setOpen] = useState(stmt.status === 'error')
  const hasBody = stmt.status !== 'skipped'

  return (
    <div className="border-b border-border-light last:border-b-0">
      <button
        type="button"
        onClick={() => hasBody && setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-border-light/40"
      >
        <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted">
          {stmt.index + 1}
        </span>
        <span
          className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[stmt.status]}`}
        >
          {stmt.status}
        </span>
        <pre className="min-w-0 flex-1 truncate font-mono text-xs text-text">{stmt.sql}</pre>
        {stmt.elapsed_ms != null && (
          <span className="shrink-0 font-mono text-[10px] text-muted">{stmt.elapsed_ms} ms</span>
        )}
      </button>

      {open && hasBody && (
        <div className="space-y-2 px-3 pb-3 pl-11">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-bg p-2 font-mono text-xs text-text-secondary">
            {stmt.sql}
          </pre>
          {stmt.error ? (
            <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {stmt.error}
            </div>
          ) : stmt.columns.length > 0 ? (
            <ResultTable
              columns={stmt.columns}
              rows={stmt.rows}
              truncated={stmt.truncated}
              filename={`statement-${stmt.index + 1}`}
            />
          ) : (
            <div className="text-xs text-text-secondary">
              OK{stmt.affected != null && stmt.affected >= 0 && ` · affected: ${stmt.affected}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ScriptResult({ result }: { result: ScriptRunResponse }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm">
        <span className="font-medium">{result.filename ?? 'Script'}</span>
        <span className="text-text-secondary">
          {result.total} statement{result.total === 1 ? '' : 's'}
        </span>
        {result.ok > 0 && <span className="text-success">{result.ok} ok</span>}
        {result.failed > 0 && <span className="text-danger">{result.failed} failed</span>}
        {result.skipped > 0 && <span className="text-muted">{result.skipped} skipped</span>}
        <span className="ml-auto font-mono text-xs text-text-secondary">
          {result.elapsed_ms} ms
        </span>
      </div>

      {result.error && (
        <div className="border-b border-border bg-danger/10 px-3 py-2 text-sm text-danger">
          <strong>Script aborted:</strong> {result.error}
        </div>
      )}

      {result.failed > 0 && (
        // Each statement autocommits on its own, so a mid-script failure leaves
        // the earlier ones applied — there is no all-or-nothing rollback.
        <div className="border-b border-border px-3 py-2 text-xs text-text-secondary">
          Statements are not wrapped in a single transaction — anything that succeeded
          before the failure has already been committed.
        </div>
      )}

      {result.total === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">No statements found in this file.</p>
      ) : (
        result.statements.map((s) => <StatementRow key={s.index} stmt={s} />)
      )}
    </div>
  )
}
