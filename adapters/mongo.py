import json
import threading

from pymongo import MongoClient
from bson import ObjectId
from bson.errors import InvalidId
from .base import BaseAdapter

# Shared MongoClient per URI — see MongoAdapter.connect()
_CLIENTS: dict[str, MongoClient] = {}
_CLIENTS_LOCK = threading.Lock()

_PYTHON_TYPE_MAP = {
    "str": "String",
    "int": "Int32",
    "float": "Double",
    "bool": "Boolean",
    "dict": "Object",
    "list": "Array",
    "NoneType": "Null",
    "ObjectId": "ObjectId",
    "datetime": "Date",
}


class MongoAdapter(BaseAdapter):

    def connect(self):
        # MongoClient maintains its own socket pool and is thread-safe —
        # cache one per URI instead of paying connection setup per request.
        uri = self.config["uri"]
        with _CLIENTS_LOCK:
            client = _CLIENTS.get(uri)
        created = client is None
        if created:
            client = MongoClient(
                uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
        # Ping every time so connect() stays a real connectivity check
        # (over an already-open pooled socket this is a single fast round trip)
        try:
            client.admin.command("ping")
        except Exception:
            if created:
                client.close()  # never cache a client that has not connected
            raise
        if created:
            with _CLIENTS_LOCK:
                other = _CLIENTS.get(uri)
                if other is None:
                    _CLIENTS[uri] = client
                else:
                    # Another thread cached one first — use theirs
                    client.close()
                    client = other
        self._client = client
        self._db = client[self.config["database"]]

    def disconnect(self):
        # The client is shared and pooled — just drop our references
        self._client = None
        self._db = None

    def list_tables(self) -> list[str]:
        return sorted(self._db.list_collection_names())

    def get_schema(self, table: str) -> list[dict]:
        sample = list(self._db[table].find({}, limit=100))
        field_types: dict[str, str] = {}
        for doc in sample:
            for key, val in doc.items():
                if key not in field_types:
                    type_name = type(val).__name__
                    field_types[key] = _PYTHON_TYPE_MAP.get(type_name, type_name)
        return [{"name": k, "type": v, "nullable": True, "primary_key": k == "_id"}
                for k, v in field_types.items()]

    def get_rows(self, table, page=1, page_size=50, filters=None, sort=None):
        col = self._db[table]
        query_filter = filters if isinstance(filters, dict) else {}

        total = col.count_documents(query_filter)
        skip = (page - 1) * page_size
        cursor = col.find(query_filter)
        if sort and sort.get("column"):
            direction = -1 if str(sort.get("dir", "")).lower() == "desc" else 1
            cursor = cursor.sort(sort["column"], direction)
        docs = list(cursor.skip(skip).limit(page_size))

        if not docs:
            return {
                "columns": [], "rows": [], "total": total,
                "page": page, "page_size": page_size, "has_next": False,
            }

        all_keys = list({k for doc in docs for k in doc})
        if "_id" in all_keys:
            all_keys = ["_id"] + [k for k in all_keys if k != "_id"]

        rows = [[str(doc.get(k, "")) for k in all_keys] for doc in docs]

        return {
            "columns": all_keys,
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_next": (skip + page_size) < total,
        }

    def get_erd_data(self) -> dict:
        """
        MongoDB has no FK relationships. Returns collections with their
        sampled field schema. ERD shows the schema graph without edges.
        """
        tables: dict = {}
        for col_name in self._db.list_collection_names():
            schema = self.get_schema(col_name)
            tables[col_name] = {"columns": schema, "foreign_keys": []}
        return {"tables": tables, "has_relations": False}

    def update_row(self, table: str, identity: dict, new_values: dict) -> dict:
        if not identity:
            return {"ok": False, "error": "No identity (_id) provided."}

        filt = {}
        for k, v in identity.items():
            if k == "_id":
                try:
                    filt[k] = ObjectId(v)
                except (InvalidId, TypeError):
                    filt[k] = v
            else:
                filt[k] = v

        set_doc = {}
        unset_doc = {}
        for k, v in new_values.items():
            if v == "__NULL__":
                unset_doc[k] = ""
                continue
            try:
                set_doc[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                set_doc[k] = v

        update_doc = {}
        if set_doc:
            update_doc["$set"] = set_doc
        if unset_doc:
            update_doc["$unset"] = unset_doc
        if not update_doc:
            return {"ok": False, "error": "No changes."}

        try:
            res = self._db[table].update_one(filt, update_doc)
            if res.matched_count == 0:
                return {"ok": False, "error": "No matching document."}
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def insert_row(self, table: str, values: dict) -> dict:
        raw = values.get("__document__", "").strip()
        if not raw:
            return {"ok": False, "error": "Document JSON is required."}
        try:
            doc = json.loads(raw)
        except json.JSONDecodeError as e:
            return {"ok": False, "error": f"Invalid JSON: {e}"}
        if not isinstance(doc, dict):
            return {"ok": False, "error": "Document must be a JSON object."}
        try:
            self._db[table].insert_one(doc)
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def execute_query(self, query_str: str) -> dict:
        """
        Accepts a JSON string:
          - dict  → find filter on the current database (requires __collection__ key or
                    falls back to first collection)
          - list  → aggregate pipeline
        Prefix with "__collection__": "name" in a dict to target a specific collection.
        """
        try:
            parsed = json.loads(query_str)
        except json.JSONDecodeError as e:
            return {"columns": [], "rows": [], "affected": None, "error": f"Invalid JSON: {e}"}

        try:
            if isinstance(parsed, dict) and "__collection__" in parsed:
                col_name = parsed.pop("__collection__")
            else:
                collections = self._db.list_collection_names()
                col_name = collections[0] if collections else ""

            if not col_name:
                return {"columns": [], "rows": [], "affected": None,
                        "error": "No collection found. Use __collection__ key to specify one."}

            col = self._db[col_name]

            if isinstance(parsed, list):
                result = list(col.aggregate(parsed))
            else:
                result = list(col.find(parsed, limit=500))

            if not result:
                return {"columns": [], "rows": [], "affected": None, "error": None}

            all_keys = list({k for doc in result for k in doc})
            if "_id" in all_keys:
                all_keys = ["_id"] + [k for k in all_keys if k != "_id"]
            rows = [[str(doc.get(k, "")) for k in all_keys] for doc in result]
            return {"columns": all_keys, "rows": rows, "affected": None, "error": None}

        except Exception as e:
            return {"columns": [], "rows": [], "affected": None, "error": str(e)}
