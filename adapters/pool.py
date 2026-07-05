"""Tiny keyed connection pool shared by the SQL adapters.

Opening a connection to a remote database costs ~5 network round trips
(TCP + TLS + auth) — the dominant cost of every request when the server
is far away, since the app opens a fresh connection per request. The
pool keeps recently used driver connections alive per connection config
so subsequent requests skip the handshake entirely.

Connections idle less than FRESH_WINDOW are handed out without a
validation query (pagination bursts reuse within seconds); older ones
are validated first and silently replaced if the server dropped them.
"""
import threading
import time

FRESH_WINDOW = 10.0  # seconds a returned connection is trusted without revalidation
IDLE_TTL = 300.0     # idle connections older than this are closed, not reused
MAX_IDLE_PER_KEY = 4  # matches the server's thread count


def _close_quietly(conn_close):
    try:
        conn_close()
    except Exception:
        pass


class KeyedPool:
    def __init__(self, fresh_window=FRESH_WINDOW, idle_ttl=IDLE_TTL,
                 max_idle_per_key=MAX_IDLE_PER_KEY):
        self._lock = threading.Lock()
        self._idle: dict[tuple, list[tuple[object, float]]] = {}
        self.fresh_window = fresh_window
        self.idle_ttl = idle_ttl
        self.max_idle_per_key = max_idle_per_key

    def acquire(self, key, factory, validate, close):
        """Return a pooled connection for `key`, or build one via `factory`.

        `validate(conn) -> bool` is only called for connections idle longer
        than the fresh window. Invalid/expired connections are closed and
        the next candidate tried.
        """
        while True:
            with self._lock:
                bucket = self._idle.get(key)
                entry = bucket.pop() if bucket else None
            if entry is None:
                return factory()
            conn, returned_at = entry
            idle_for = time.monotonic() - returned_at
            if idle_for > self.idle_ttl:
                _close_quietly(lambda: close(conn))
                continue
            if idle_for > self.fresh_window:
                ok = False
                try:
                    ok = validate(conn)
                except Exception:
                    ok = False
                if not ok:
                    _close_quietly(lambda: close(conn))
                    continue
            return conn

    def release(self, key, conn, reset, close):
        """Return a connection to the pool. `reset(conn)` restores it to a
        clean state (e.g. rollback); if reset fails the connection is closed
        instead of pooled."""
        try:
            reset(conn)
        except Exception:
            _close_quietly(lambda: close(conn))
            return
        with self._lock:
            bucket = self._idle.setdefault(key, [])
            if len(bucket) >= self.max_idle_per_key:
                overflow = conn
            else:
                bucket.append((conn, time.monotonic()))
                overflow = None
        if overflow is not None:
            _close_quietly(lambda: close(overflow))


# One pool per process, shared by all SQL adapters (keys are namespaced
# by db_type so postgres and mysql entries never collide).
POOL = KeyedPool()
