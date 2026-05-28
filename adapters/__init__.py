from .postgres import PostgresAdapter
from .mysql import MySQLAdapter
from .sqlite import SQLiteAdapter
from .mongo import MongoAdapter
from .dynamo import DynamoAdapter

ADAPTER_REGISTRY = {
    "postgresql": PostgresAdapter,
    "mysql": MySQLAdapter,
    "sqlite": SQLiteAdapter,
    "mongodb": MongoAdapter,
    "dynamodb": DynamoAdapter,
}


def get_adapter(config: dict):
    db_type = config.get("db_type")
    cls = ADAPTER_REGISTRY.get(db_type)
    if not cls:
        raise ValueError(
            f"Unsupported db_type: {db_type!r}. Valid: {list(ADAPTER_REGISTRY)}"
        )
    return cls(config)
