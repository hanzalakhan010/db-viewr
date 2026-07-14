"""BI object persistence (saved queries, charts, dashboards) for the Flask app."""
import json
import os
import tempfile
import threading

# Serializes load-mutate-save sequences so concurrent requests can't lose updates.
BI_STORE_LOCK = threading.Lock()

# Allow overriding via env var so Docker can mount a persistent data volume
BI_STORAGE_FILE = os.environ.get(
    "BI_STORAGE_FILE",
    os.path.join(os.path.dirname(__file__), "bi_storage.json"),
)

_EMPTY_STORE = {"queries": {}, "charts": {}, "dashboards": {}}


def load_bi_store() -> dict:
    if not os.path.exists(BI_STORAGE_FILE):
        return {k: {} for k in _EMPTY_STORE}
    try:
        with open(BI_STORAGE_FILE) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {k: {} for k in _EMPTY_STORE}
    if not isinstance(data, dict):
        return {k: {} for k in _EMPTY_STORE}
    return {k: data.get(k) if isinstance(data.get(k), dict) else {} for k in _EMPTY_STORE}


def save_bi_store(store: dict) -> None:
    # Atomic write: dump to a temp file in the same directory, then replace.
    dirname = os.path.dirname(BI_STORAGE_FILE) or "."
    fd, tmp_path = tempfile.mkstemp(dir=dirname, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(store, f, indent=2)
        os.replace(tmp_path, BI_STORAGE_FILE)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
