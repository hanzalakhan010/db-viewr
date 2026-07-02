"""Connection persistence shared by the Flask app and the MCP server."""
import json
import os

# Allow overriding via env var so Docker can mount a persistent data volume
CONNECTIONS_FILE = os.environ.get(
    "CONNECTIONS_FILE",
    os.path.join(os.path.dirname(__file__), "connections.json"),
)


def load_connections() -> dict:
    if not os.path.exists(CONNECTIONS_FILE):
        return {}
    with open(CONNECTIONS_FILE) as f:
        return json.load(f)


def save_connections(conns: dict) -> None:
    with open(CONNECTIONS_FILE, "w") as f:
        json.dump(conns, f, indent=2)


def connection_public(conn: dict, secret_fields: tuple[str, ...]) -> dict:
    out = {}
    for k, v in conn.items():
        if k in secret_fields:
            continue
        out[k] = v
    out["id"] = conn.get("id")
    for sf in secret_fields:
        out[f"has_{sf}"] = bool(conn.get(sf))
    return out
