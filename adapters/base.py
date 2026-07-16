import socket
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError


def resolve_host_with_timeout(host: str, port: int, timeout: float = 10) -> None:
    """Raise ConnectionError if `host` doesn't resolve within `timeout` seconds.

    DB drivers' own connect_timeout only bounds the TCP handshake, not DNS
    resolution — a stalled resolver (e.g. a flaky path to a private RDS
    hostname) can hang past it indefinitely. Resolving up front in a worker
    thread lets us give up on a hung lookup instead of blocking the caller.
    """
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(socket.getaddrinfo, host, port)
    try:
        future.result(timeout=timeout)
    except FutureTimeoutError:
        raise ConnectionError(
            f"Could not resolve host '{host}': DNS lookup timed out after {timeout}s"
        )
    finally:
        pool.shutdown(wait=False)


class BaseAdapter(ABC):
    """Abstract base for all DB adapters."""

    def __init__(self, config: dict):
        self.config = config
        self._conn = None

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    @abstractmethod
    def connect(self) -> None:
        ...

    @abstractmethod
    def disconnect(self) -> None:
        ...

    def test_connection(self) -> tuple[bool, str]:
        try:
            self.connect()
            self.disconnect()
            return True, ""
        except Exception as e:
            return False, str(e)

    # ── Schema Discovery ───────────────────────────────────────────────────────

    @abstractmethod
    def list_tables(self) -> list[str]:
        ...

    @abstractmethod
    def get_schema(self, table: str) -> list[dict]:
        """
        Returns list of dicts with keys: name, type, nullable, primary_key.
        MongoDB/DynamoDB may omit nullable/primary_key.
        """
        ...

    # ── Data Retrieval ─────────────────────────────────────────────────────────

    @abstractmethod
    def get_rows(
        self,
        table: str,
        page: int = 1,
        page_size: int = 50,
        filters: dict | None = None,
        sort: dict | None = None,
    ) -> dict:
        """
        Returns:
          {columns, rows, total (int|None), page, page_size, has_next}
        total is None when a count is too expensive (DynamoDB).
        sort is {"column": str, "dir": "asc"|"desc"} or None.
        """
        ...

    @abstractmethod
    def execute_query(self, query_str: str) -> dict:
        """
        Returns:
          {columns, rows, affected (int|None), error (str|None)}
        """
        ...

    @abstractmethod
    def update_row(self, table: str, identity: dict, new_values: dict) -> dict:
        """
        Update a row/document/item identified by `identity` (map of
        PK/key column → original value). `new_values` maps columns being
        edited to their new raw string values. Use "__NULL__" to set NULL.
        Returns:
          {ok: bool, error: str|None}
        """
        ...

    @abstractmethod
    def insert_row(self, table: str, values: dict) -> dict:
        """
        Insert a new row/document/item into the given table.
        `values` maps column/field name to its raw string value (UI form input).
        Adapters are responsible for coercing types and skipping empty
        optional fields.
        Returns:
          {ok: bool, error: str|None}
        """
        ...

    @abstractmethod
    def get_erd_data(self) -> dict:
        """
        Returns data needed to render an ERD diagram:
        {
            "tables": {
                "table_name": {
                    "columns": [
                        {"name": str, "type": str,
                         "primary_key": bool, "nullable": bool}
                    ],
                    "foreign_keys": [
                        {"column": str, "ref_table": str, "ref_column": str}
                    ]
                }
            },
            "has_relations": bool
        }
        MongoDB/DynamoDB return empty foreign_keys lists and has_relations=False.
        """
        ...
