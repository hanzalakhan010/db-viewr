export type DbType = 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'dynamodb'

export interface ConnectionPublic {
  id: string
  name: string
  db_type: DbType
  host?: string
  port?: number | string
  database?: string
  user?: string
  schema?: string
  path?: string
  uri?: string
  region?: string
  access_key_id?: string
  endpoint_url?: string
  has_password?: boolean
  has_secret_access_key?: boolean
}

export interface ConnectionInput {
  name: string
  db_type: DbType
  host?: string
  port?: string
  database?: string
  user?: string
  password?: string
  schema?: string
  path?: string
  uri?: string
  region?: string
  access_key_id?: string
  secret_access_key?: string
  endpoint_url?: string
}

export interface ConnectionsResponse {
  connections: ConnectionPublic[]
}

export interface ConnectionResponse {
  connection: ConnectionPublic
}

export interface TablesResponse {
  tables: string[]
}

export interface TestResponse {
  ok: boolean
  error: string | null
}

export interface ColumnDef {
  name: string
  type?: string
  nullable?: boolean
  // Backend sends `primary_key`; this used to be read as `pk` and never
  // matched, so no PK was ever detected in the table view.
  primary_key?: boolean
}

// FK edges touching the table currently in view (see backend _relations_for).
export interface OutboundRef {
  column: string // FK column in this table
  ref_table: string
  ref_column: string
}
export interface InboundRef {
  from_table: string // child table referencing us
  from_column: string // child's FK column
  ref_column: string // our column it points at
}
export interface Relations {
  outbound: OutboundRef[]
  inbound: InboundRef[]
}

export interface TableRowsResponse {
  schema: ColumnDef[]
  data: {
    columns: string[]
    rows: unknown[][]
    total: number | null
    page: number
    page_size: number
    has_next: boolean
  }
  relations?: Relations
  elapsed_ms: number | null
  db_type: string
}

export interface MutationResult {
  ok: boolean
  error?: string
}

export interface TableViewParams {
  page: number
  page_size: number
  sort_col?: string
  sort_dir?: 'asc' | 'desc'
  filter_col?: string
  filter_op?: string
  filter_val?: string
  adv_filters?: string
  filter_json?: string
  filter_fe?: string
  filter_eav?: string
}

export interface QueryHistoryItem {
  q: string
  t: number
}

export interface QueryHistoryResponse {
  history: QueryHistoryItem[]
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  affected: number | null
  error: string | null
  elapsed_ms: number | null
}

export interface ScriptStatementResult {
  index: number
  /** Truncated to ~2000 chars server-side, so this may end in an ellipsis. */
  sql: string
  status: 'ok' | 'error' | 'skipped'
  columns: string[]
  rows: unknown[][]
  affected: number | null
  error: string | null
  elapsed_ms: number | null
  /** Server capped the row list at 500 for this statement. */
  truncated: boolean
}

export interface ScriptRunResponse {
  filename: string | null
  total: number
  ok: number
  failed: number
  skipped: number
  elapsed_ms: number
  /** Connection-level failure, distinct from a per-statement SQL error. */
  error: string | null
  statements: ScriptStatementResult[]
}

export interface ErdForeignKey {
  column: string
  ref_table: string
  ref_column: string
}

export interface ErdColumn {
  name: string
  type?: string
  primary_key?: boolean
}

export interface ErdTable {
  columns: ErdColumn[]
  foreign_keys?: ErdForeignKey[]
}

export interface ErdResponse {
  erd: { tables: Record<string, ErdTable>; has_relations: boolean }
  rel_count: number
}

// ── Saved views (visual join builder) ──────────────────────────────────────
export type JoinType = 'inner' | 'left'

export interface ViewJoin {
  from_table: string
  from_col: string
  to_table: string
  to_col: string
  join_type: JoinType
}

export interface ViewColumn {
  table: string
  column: string
}

export interface ViewSort {
  table: string
  column: string
  dir: 'asc' | 'desc'
}

export interface ViewFilterCondition {
  table?: string
  column: string
  op: string
  value?: string
  value2?: string
}

export interface ViewFilters {
  advanced: true
  combinator: 'AND' | 'OR'
  conditions: ViewFilterCondition[]
}

export interface ViewSpec {
  base_table: string
  joins: ViewJoin[]
  columns: ViewColumn[]
  filters?: ViewFilters | null
  sort?: ViewSort | null
}

export interface SavedView {
  id: string
  name: string
  spec: ViewSpec
  created_at: number
  updated_at: number
}

export interface ViewsResponse {
  views: SavedView[]
}

export interface ViewRunResponse {
  columns: string[]
  rows: unknown[][]
  page: number
  page_size: number
  has_next: boolean
  total: number | null
  elapsed_ms: number | null
  error: string | null
}

export interface OcrLine {
  text: string
  confidence: number
  box: [number, number, number, number]
}

export interface OcrResponse {
  text: string
  lines: OcrLine[]
  engine: string
  elapsed_ms: number
  width: number
  height: number
  processed_width: number
  processed_height: number
}

export const DB_TYPE_LABELS: Record<DbType, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  dynamodb: 'DynamoDB',
}
