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
  pk?: boolean
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

export const DB_TYPE_LABELS: Record<DbType, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  dynamodb: 'DynamoDB',
}
