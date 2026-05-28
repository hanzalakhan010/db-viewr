import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-medium">Not found</h1>
      <Link to="/" className="text-info hover:underline">
        Back to connections
      </Link>
    </div>
  )
}
