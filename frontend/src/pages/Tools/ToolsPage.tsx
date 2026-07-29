import { Link } from 'react-router-dom'

interface Tool {
  to: string
  name: string
  description: string
  badge: string
}

const TOOLS: Tool[] = [
  {
    to: '/tools/ocr',
    name: 'OCR',
    description:
      'Drop or paste an image and extract its text. Runs fully locally — nothing leaves your machine.',
    badge: 'Local',
  },
]

export function ToolsPage() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">Tools</h1>
      </div>
      <p className="mb-4 text-sm text-text-secondary">
        Small utilities for fast-paced work. Independent of database connections.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-lg border border-border bg-surface p-4 hover:border-accent"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium text-info">{t.name}</span>
              <span className="rounded bg-border-light px-2 py-0.5 text-xs text-text-secondary">
                {t.badge}
              </span>
            </div>
            <p className="text-sm text-text-secondary">{t.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
