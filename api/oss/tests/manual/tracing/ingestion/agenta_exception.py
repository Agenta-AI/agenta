# /// script
# dependencies = ["agenta"]
# ///
import agenta as ag

from dotenv import load_dotenv

load_dotenv(override=True)


ag.init()


@ag.instrument(spankind="task")
def llm_function(topic: str, genre: str, count: int = 5):
    ag.tracing.store_internals({"topic2": topic, "genre2": genre, "count2": count})
    raise Exception("test")
    return topic, genre, count


@ag.instrument(spankind="WORKFLOW")
def main2(topic: str, genre: str, count: int = 5):
    ag.tracing.store_internals({"topic": topic, "genre": genre, "count": count})
    ag.tracing.store_meta({"topic": topic, "genre": genre, "count": count})
    ag.tracing.store_refs({"environment.slug": "production"})

    return llm_function(topic, genre, count)


if __name__ == "__main__":
    main2(topic="df", genre="d", count=1)
