import json
import boto3
from .base import BaseAdapter

_DYNAMO_TYPE_MAP = {
    "S": "String", "N": "Number", "B": "Binary",
    "BOOL": "Boolean", "NULL": "Null", "L": "List", "M": "Map",
}


class DynamoAdapter(BaseAdapter):

    def connect(self):
        kwargs = dict(
            region_name=self.config.get("region", "us-east-1"),
            aws_access_key_id=self.config.get("access_key_id") or None,
            aws_secret_access_key=self.config.get("secret_access_key") or None,
        )
        endpoint = self.config.get("endpoint_url", "").strip()
        if endpoint:
            kwargs["endpoint_url"] = endpoint

        self._resource = boto3.resource("dynamodb", **kwargs)
        self._client = boto3.client("dynamodb", **kwargs)
        # Quick connectivity check
        self._client.list_tables(Limit=1)

    def disconnect(self):
        self._resource = None
        self._client = None

    def list_tables(self) -> list[str]:
        tables = []
        paginator = self._client.get_paginator("list_tables")
        for page in paginator.paginate():
            tables.extend(page["TableNames"])
        return sorted(tables)

    def get_schema(self, table: str) -> list[dict]:
        desc = self._client.describe_table(TableName=table)["Table"]
        attr_types = {a["AttributeName"]: a["AttributeType"]
                      for a in desc["AttributeDefinitions"]}
        key_roles = {k["AttributeName"]: k["KeyType"]
                     for k in desc["KeySchema"]}

        return [
            {
                "name": attr_name,
                "type": _DYNAMO_TYPE_MAP.get(attr_type, attr_type),
                "nullable": False,
                "primary_key": key_roles.get(attr_name) == "HASH",
                "key_type": key_roles.get(attr_name),
            }
            for attr_name, attr_type in attr_types.items()
        ]

    def get_rows(self, table, page=1, page_size=50, filters=None, sort=None):
        dynamo_table = self._resource.Table(table)
        scan_kwargs: dict = {"Limit": page_size}

        if filters and filters.get("FilterExpression"):
            scan_kwargs["FilterExpression"] = filters["FilterExpression"]
            if filters.get("ExpressionAttributeValues"):
                scan_kwargs["ExpressionAttributeValues"] = filters["ExpressionAttributeValues"]

        # Advance through pages by iterating LastEvaluatedKey
        last_key = None
        for _ in range(page - 1):
            resp = dynamo_table.scan(Limit=page_size,
                                     **({"ExclusiveStartKey": last_key} if last_key else {}))
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                return {
                    "columns": [], "rows": [], "total": None,
                    "page": page, "page_size": page_size, "has_next": False,
                }

        if last_key:
            scan_kwargs["ExclusiveStartKey"] = last_key

        response = dynamo_table.scan(**scan_kwargs)
        items = response.get("Items", [])

        if not items:
            return {
                "columns": [], "rows": [], "total": None,
                "page": page, "page_size": page_size, "has_next": False,
            }

        all_keys = list({k for item in items for k in item})
        rows = [[str(item.get(k, "")) for k in all_keys] for item in items]

        return {
            "columns": all_keys,
            "rows": rows,
            "total": None,
            "page": page,
            "page_size": page_size,
            "has_next": bool(response.get("LastEvaluatedKey")),
        }

    def get_erd_data(self) -> dict:
        """
        DynamoDB has no FK relationships. Returns tables with their
        key-schema attributes. ERD shows the schema graph without edges.
        """
        tables: dict = {}
        for tname in self.list_tables():
            schema = self.get_schema(tname)
            tables[tname] = {"columns": schema, "foreign_keys": []}
        return {"tables": tables, "has_relations": False}

    def update_row(self, table: str, identity: dict, new_values: dict) -> dict:
        from decimal import Decimal, InvalidOperation

        if not identity:
            return {"ok": False, "error": "No key attributes provided."}

        desc = self._client.describe_table(TableName=table)["Table"]
        attr_types = {a["AttributeName"]: a["AttributeType"]
                      for a in desc["AttributeDefinitions"]}

        def coerce(name, val):
            atype = attr_types.get(name)
            if atype == "N":
                return Decimal(val)
            if atype == "S":
                return val
            try:
                return Decimal(val)
            except (InvalidOperation, ValueError, TypeError):
                return val

        try:
            key = {k: coerce(k, v) for k, v in identity.items()}
        except Exception as e:
            return {"ok": False, "error": f"Invalid key value: {e}"}

        names = {}
        expr_vals = {}
        set_parts = []
        remove_parts = []
        for i, (k, v) in enumerate(new_values.items()):
            name_key = f"#n{i}"
            names[name_key] = k
            if v == "__NULL__":
                remove_parts.append(name_key)
            else:
                val_key = f":v{i}"
                expr_vals[val_key] = coerce(k, v)
                set_parts.append(f"{name_key} = {val_key}")

        parts = []
        if set_parts:
            parts.append("SET " + ", ".join(set_parts))
        if remove_parts:
            parts.append("REMOVE " + ", ".join(remove_parts))
        if not parts:
            return {"ok": False, "error": "No changes."}

        kwargs = {
            "Key": key,
            "UpdateExpression": " ".join(parts),
            "ExpressionAttributeNames": names,
        }
        if expr_vals:
            kwargs["ExpressionAttributeValues"] = expr_vals

        try:
            self._resource.Table(table).update_item(**kwargs)
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def insert_row(self, table: str, values: dict) -> dict:
        raw = values.get("__document__", "").strip()
        if not raw:
            return {"ok": False, "error": "Item JSON is required."}
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as e:
            return {"ok": False, "error": f"Invalid JSON: {e}"}
        if not isinstance(item, dict):
            return {"ok": False, "error": "Item must be a JSON object."}
        try:
            self._resource.Table(table).put_item(Item=item)
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def execute_query(self, query_str: str) -> dict:
        """Executes a PartiQL statement via execute_statement."""
        try:
            response = self._client.execute_statement(Statement=query_str)
            items = response.get("Items", [])

            if not items:
                return {"columns": [], "rows": [], "affected": None, "error": None}

            def _flatten(dynamo_item: dict) -> dict:
                return {k: list(v.values())[0] for k, v in dynamo_item.items()}

            flat = [_flatten(i) for i in items]
            all_keys = list({k for d in flat for k in d})
            rows = [[str(d.get(k, "")) for k in all_keys] for d in flat]
            return {"columns": all_keys, "rows": rows, "affected": None, "error": None}

        except Exception as e:
            return {"columns": [], "rows": [], "affected": None, "error": str(e)}
