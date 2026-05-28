import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api'
import { Loading } from '@/components/Spinner'
import {
  DB_TYPE_LABELS,
  type ConnectionInput,
  type ConnectionPublic,
  type ConnectionResponse,
  type DbType,
} from '@/lib/types'

type Mode = 'new' | 'edit'

const EMPTY: ConnectionInput = {
  name: '',
  db_type: 'postgresql',
  host: 'localhost',
  port: '',
  database: '',
  user: '',
  password: '',
  schema: 'public',
  path: '',
  uri: 'mongodb://localhost:27017',
  region: 'us-east-1',
  access_key_id: '',
  secret_access_key: '',
  endpoint_url: '',
}

function fromExisting(c: ConnectionPublic): ConnectionInput {
  return {
    name: c.name,
    db_type: c.db_type,
    host: c.host ?? '',
    port: c.port != null ? String(c.port) : '',
    database: c.database ?? '',
    user: c.user ?? '',
    password: '',
    schema: c.schema ?? '',
    path: c.path ?? '',
    uri: c.uri ?? '',
    region: c.region ?? '',
    access_key_id: c.access_key_id ?? '',
    secret_access_key: '',
    endpoint_url: c.endpoint_url ?? '',
  }
}

export function ConnectionFormPage({ mode }: { mode: Mode }) {
  const { conn: connId } = useParams<{ conn: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<ConnectionInput>(EMPTY)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const existing = useQuery({
    queryKey: ['connections', connId],
    queryFn: () => apiFetch<ConnectionResponse>(`connections/${connId}`),
    enabled: mode === 'edit' && !!connId,
  })

  useEffect(() => {
    if (mode === 'edit' && existing.data) {
      setForm(fromExisting(existing.data.connection))
    }
  }, [mode, existing.data])

  const saveMut = useMutation({
    mutationFn: (payload: ConnectionInput) =>
      mode === 'new'
        ? apiFetch<ConnectionResponse>('connections', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
        : apiFetch<ConnectionResponse>(`connections/${connId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] })
      navigate('/')
    },
    onError: (e: unknown) => {
      setSubmitError(e instanceof ApiError ? e.message : 'Save failed')
    },
  })

  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    saveMut.mutate(form)
  }

  const t = form.db_type
  const passwordPlaceholder = mode === 'edit' ? '(unchanged)' : ''
  const isEditLoading = mode === 'edit' && existing.isLoading

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-medium">
        {mode === 'edit' ? 'Edit Connection' : 'New Connection'}
      </h1>

      {submitError && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {submitError}
        </div>
      )}
      {existing.error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(existing.error as Error).message}
        </div>
      )}

      {isEditLoading ? (
        <Loading />
      ) : (
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-lg border border-border bg-surface p-6"
        >
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My Database"
              className={inputCls}
            />
          </Field>

          <Field label="Database Type">
            <select
              required
              value={form.db_type}
              onChange={(e) => set('db_type', e.target.value as DbType)}
              className={inputCls}
            >
              {Object.entries(DB_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          {(t === 'postgresql' || t === 'mysql') && (
            <Group legend="Connection">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Host">
                  <input
                    value={form.host ?? ''}
                    onChange={(e) => set('host', e.target.value)}
                    placeholder="localhost"
                    className={inputCls}
                  />
                </Field>
                <Field label="Port">
                  <input
                    value={form.port ?? ''}
                    onChange={(e) => set('port', e.target.value)}
                    placeholder={t === 'postgresql' ? '5432' : '3306'}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Database name">
                <input
                  value={form.database ?? ''}
                  onChange={(e) => set('database', e.target.value)}
                  placeholder="mydb"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="User">
                  <input
                    value={form.user ?? ''}
                    onChange={(e) => set('user', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={form.password ?? ''}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder={passwordPlaceholder}
                    className={inputCls}
                  />
                </Field>
              </div>
            </Group>
          )}

          {t === 'postgresql' && (
            <Group legend="Options">
              <Field label="Schema">
                <input
                  value={form.schema ?? ''}
                  onChange={(e) => set('schema', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </Group>
          )}

          {t === 'sqlite' && (
            <Group legend="SQLite File">
              <Field label="File path">
                <input
                  value={form.path ?? ''}
                  onChange={(e) => set('path', e.target.value)}
                  placeholder="/home/user/mydb.db"
                  className={inputCls}
                />
              </Field>
            </Group>
          )}

          {t === 'mongodb' && (
            <Group legend="MongoDB">
              <Field label="URI">
                <input
                  value={form.uri ?? ''}
                  onChange={(e) => set('uri', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Database name">
                <input
                  value={form.database ?? ''}
                  onChange={(e) => set('database', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </Group>
          )}

          {t === 'dynamodb' && (
            <Group legend="DynamoDB / AWS">
              <Field label="Region">
                <input
                  value={form.region ?? ''}
                  onChange={(e) => set('region', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Access Key ID">
                  <input
                    value={form.access_key_id ?? ''}
                    onChange={(e) => set('access_key_id', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Secret Access Key">
                  <input
                    type="password"
                    value={form.secret_access_key ?? ''}
                    onChange={(e) => set('secret_access_key', e.target.value)}
                    placeholder={passwordPlaceholder}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field
                label="Endpoint URL"
                hint="optional — for DynamoDB Local / LocalStack"
              >
                <input
                  value={form.endpoint_url ?? ''}
                  onChange={(e) => set('endpoint_url', e.target.value)}
                  placeholder="http://localhost:8000"
                  className={inputCls}
                />
              </Field>
            </Group>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {saveMut.isPending
                ? 'Saving…'
                : mode === 'edit'
                  ? 'Update Connection'
                  : 'Save Connection'}
            </button>
            <Link to="/" className="text-sm text-info hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}

const inputCls =
  'mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-info'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="text-text-secondary">
        {label}
        {hint && <span className="ml-1 text-muted">({hint})</span>}
      </span>
      {children}
    </label>
  )
}

function Group({
  legend,
  children,
}: {
  legend: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="space-y-3 rounded border border-border-light p-4">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}
