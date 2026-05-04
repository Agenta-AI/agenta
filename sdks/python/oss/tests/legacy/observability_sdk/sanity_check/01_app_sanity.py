import agenta as ag
from agenta.sdk.assets import supported_llm_models


ag.init()

ag.config.default(
    temperature=ag.FloatParam(0.2),
    model=ag.GroupedMultipleChoiceParam(
        default="gpt-3.5-turbo", choices=supported_llm_models
    ),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam("MY_SYSTEM_PROMPT"),
)


@ag.instrument(spankind="WORKFLOW")
async def main2(topic: str, genre: str, count: int = 5):
    return "test"


if __name__ == "__main__":
    import asyncio

    asyncio.run(main2(topic="df", genre="d", count=1))
