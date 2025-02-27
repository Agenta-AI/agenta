import sqlite3
from typing import List
import json


def setup_db():
    conn = sqlite3.connect("context.db")
    c = conn.cursor()
    c.execute(
        """
    CREATE TABLE IF NOT EXISTS contexts
    (id INTEGER PRIMARY KEY AUTOINCREMENT, context TEXT)
    """
    )
    conn.commit()
    conn.close()


class Context:
    def __init__(self, **kwargs):
        self.context_data = kwargs

    def __getattr__(self, item):
        return self.context_data.get(item, None)

    def to_json(self):
        return json.dumps(self.context_data)

    @classmethod
    def from_json(cls, json_str: str):
        data = json.loads(json_str)
        return cls(**data)


def get_contexts() -> List[Context]:
    contexts = []
    conn = sqlite3.connect("context.db")
    c = conn.cursor()
    for row in c.execute("SELECT * FROM contexts"):
        contexts.append(Context.from_json(row[1]))
    conn.close()
    return contexts


def save_context(result: Context):
    conn = sqlite3.connect("context.db")
    c = conn.cursor()
    c.execute(
        """
    INSERT INTO contexts (context) VALUES (?)
    """,
        (result.to_json(),),
    )
    conn.commit()
    conn.close()
