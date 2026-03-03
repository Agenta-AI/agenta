import agenta as ag

ag.init()


@ag.instrument(spankind="LLM")
def llm_function(topic: str, genre: str, count: int = 5):
    ag.tracing.store_internals({"topic2": topic, "genre2": genre, "count2": count})

    return topic, genre, count


@ag.instrument(spankind="WORKFLOW")
async def main2(topic: str, genre: str, count: int = 5):
    ag.tracing.store_internals({"topic": topic, "genre": genre, "count": count})
    ag.tracing.store_meta({"topic": topic, "genre": genre, "count": count})
    from agenta.sdk.tracing.conventions import Reference

    print("application.id" in [_.value for _ in Reference.__members__.values()])
    print("variant.id" in [_.value for _ in Reference.__members__.values()])
    ag.tracing.store_refs(
        {
            "application.id": "0192d8f2-939b-7add-99f2-b486c657d602",
            "variant.id": "0192d8f3-2c6a-7904-9dd6-1544fa1c091e",
        }
    )
    ag.tracing.store_refs({"environment.slug": "production"})
    # class Reference(str, Enum):
    # #
    # VARIANT_ID = "variant.id"
    # VARIANT_SLUG = "variant.slug"
    # VARIANT_VERSION = "variant.version"
    # #
    # ENVIRONMENT_ID = "environment.id"
    # ENVIRONMENT_SLUG = "environment.slug"
    # ENVIRONMENT_VERSION = "environment.version"
    # #
    # APPLICATION_ID = "application.id"
    # APPLICATION_SLUG = "application.slug"
    #

    return topic, genre, count


if __name__ == "__main__":
    import asyncio

    asyncio.run(main2(topic="df", genre="d", count=1))
