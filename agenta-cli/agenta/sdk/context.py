import json
import sqlite3
from typing import List
from .types import Context


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


def get_contexts() -> List[Context]:
    contexts = []
    conn = sqlite3.connect("context.db")
    c = conn.cursor()
    for row in c.execute("SELECT * FROM contexts"):
        context_data = json.loads(row[1])
        contexts.append(Context.parse_obj(context_data))
    conn.close()
    return contexts


def save_context(result: Context):
    conn = sqlite3.connect("context.db")
    c = conn.cursor()
    c.execute(
        """
    INSERT INTO contexts (context) VALUES (?)
    """,
        (json.dumps(result.dict()),),
    )
    conn.commit()
    conn.close()
