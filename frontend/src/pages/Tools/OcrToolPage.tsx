import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { OcrResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Loading } from '@/components/Spinner'

type ResultTab = 'text' | 'lines'

export function OcrToolPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<OcrResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<ResultTab>('text')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<string | null>(null)

  const process = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(`Not an image: ${file.type || file.name}`)
      return
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = URL.createObjectURL(file)
    previewRef.current = url
    setPreview(url)
    setFileName(file.name || 'pasted image')
    setResult(null)
    setError(null)
    setBusy(true)
    try {
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/tools/ocr', { method: 'POST', body: form })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const msg =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `Request failed (${res.status})`
        throw new Error(msg)
      }
      setResult(body as OcrResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed')
    } finally {
      setBusy(false)
    }
  }, [])

  // Paste-from-clipboard: hit Ctrl/Cmd+V anywhere on the page with a
  // screenshot in the clipboard and it runs immediately.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (file) {
        e.preventDefault()
        void process(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [process])

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void process(file)
  }

  const copyText = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-medium">OCR</h1>
        <span className="rounded bg-border-light px-2 py-0.5 text-xs text-text-secondary">
          Local — nothing leaves your machine
        </span>
        <Link to="/tools" className="ml-auto text-sm text-info hover:underline">
          ← All tools
        </Link>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-surface px-6 py-10 text-center transition-colors',
          dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void process(file)
            e.target.value = ''
          }}
        />
        <p className="font-medium">
          Drop an image, click to browse, or paste from clipboard
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          Screenshots, photos, scans — PNG, JPEG, WebP… up to 20 MB
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {(preview || busy || result) && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {preview && (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="flex items-center border-b border-border-light px-3 py-2 text-sm">
                <span className="truncate font-medium">{fileName}</span>
                {result && (
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    {result.width}×{result.height}
                  </span>
                )}
              </div>
              <div className="flex max-h-[32rem] items-center justify-center overflow-auto bg-border-light/50 p-3">
                <img src={preview} alt="OCR input" className="max-w-full" />
              </div>
            </div>
          )}

          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-1 border-b border-border-light px-3 py-2">
              <TabButton active={tab === 'text'} onClick={() => setTab('text')}>
                Text
              </TabButton>
              <TabButton active={tab === 'lines'} onClick={() => setTab('lines')}>
                Lines{result ? ` (${result.lines.length})` : ''}
              </TabButton>
              {result && (
                <>
                  <span className="ml-auto text-xs text-muted">
                    {result.engine} · {result.elapsed_ms} ms
                  </span>
                  <button
                    onClick={copyText}
                    className="ml-2 rounded border border-border px-2 py-1 text-xs hover:bg-border-light"
                  >
                    {copied ? '✓ Copied' : 'Copy all'}
                  </button>
                </>
              )}
            </div>

            {busy ? (
              <div className="p-6">
                <Loading />
              </div>
            ) : !result ? (
              <div className="p-6 text-sm text-text-secondary">
                Extracted text will appear here.
              </div>
            ) : result.lines.length === 0 ? (
              <div className="p-6 text-sm text-text-secondary">
                No text detected in this image.
              </div>
            ) : tab === 'text' ? (
              <textarea
                readOnly
                value={result.text}
                className="min-h-[16rem] flex-1 resize-y bg-surface p-3 font-mono text-sm outline-none"
              />
            ) : (
              <div className="max-h-[32rem] overflow-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {result.lines.map((line, i) => (
                      <tr key={i} className="border-t border-border-light first:border-t-0">
                        <td className="w-14 px-3 py-1.5 align-top">
                          <span
                            className={cn(
                              'text-xs tabular-nums',
                              line.confidence >= 0.9
                                ? 'text-success'
                                : line.confidence >= 0.7
                                  ? 'text-muted'
                                  : 'text-danger',
                            )}
                            title="Confidence"
                          >
                            {(line.confidence * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono">{line.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-2 py-1 text-xs',
        active
          ? 'bg-border-light font-medium'
          : 'text-text-secondary hover:bg-border-light/60',
      )}
    >
      {children}
    </button>
  )
}
