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


@ag.entrypoint
@ag.instrument(
    spankind="EMBEDDING",
    ignore_outputs=["ignored", "cost", "usage"],
)
def embed(description: str):
    print("embed")
    return {
        "embedding": "somedata",
        "ignored": "ignored",
        "cost": 15,
        "usage": 20,
    }
