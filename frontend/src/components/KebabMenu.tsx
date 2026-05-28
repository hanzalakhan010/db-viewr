import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Item {
  label: string
  onClick?: () => void
  href?: string
  danger?: boolean
}

interface Props {
  items: Item[]
  align?: 'left' | 'right'
  children?: ReactNode
}

export function KebabMenu({ items, align = 'right' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-label="More actions"
        className="rounded border border-border px-2 py-1 text-sm text-text-secondary hover:bg-border-light"
      >
        ⋯
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 min-w-[10rem] rounded-md border border-border bg-surface py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((it, i) =>
            it.href ? (
              <a
                key={i}
                href={it.href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-1.5 text-sm hover:bg-border-light ${
                  it.danger ? 'text-danger' : 'text-text'
                }`}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setOpen(false)
                  it.onClick?.()
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-border-light ${
                  it.danger ? 'text-danger' : 'text-text'
                }`}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
