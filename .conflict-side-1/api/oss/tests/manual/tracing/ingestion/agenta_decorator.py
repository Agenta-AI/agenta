# /// script
# dependencies = ["agenta"]
# ///
import agenta as ag
from dotenv import load_dotenv
from typing import Dict

load_dotenv(override=True)
ag.init()


@ag.instrument(spankind="task")  # mistake to test
def task_tuple(topic: str, genre: str, count: int = 5, test: Dict[str, str] = {}):
    ag.tracing.store_internals({"topic2": topic, "genre2": genre, "count2": count})

    return topic, genre, count, test


@ag.instrument(spankind="task")
def task_list(topic: str, genre: str, count: int = 5, test: Dict[str, str] = {}):
    ag.tracing.store_internals({"topic2": topic, "genre2": genre, "count2": count})
    return [topic, genre, count, test]


@ag.instrument(spankind="WORKFLOW")
async def main2(topic: str, genre: str, count: int = 5):
    ag.tracing.store_internals({"topic": topic, "genre": genre, "count": count})
    ag.tracing.store_meta({"topic": topic, "genre": genre, "count": count})
    ag.tracing.store_refs({"environment.slug": "production"})

    return {
        "result": task_tuple(topic, genre, count, {"test": {"test2": "test3"}}),
        "result2": task_list(topic, genre, count, {"test": "test"}),
    }


if __name__ == "__main__":
    import asyncio

    asyncio.run(main2(topic="df", genre="d", count=1))
