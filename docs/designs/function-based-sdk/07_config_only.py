"""Configuration-only workflows: prompt management and beyond. (POC, does not run.)

Two answers to "I want the config, not the runnable":

1. Any pushed handle already works that way. A pushed workflow registers its
   schemas and parameters on the platform; the handler only executes where your
   code runs. If you never serve it, the platform side is exactly a managed,
   versioned configuration. Just call fetch_parameters() and never invoke.

2. ag.configuration() makes that intent explicit. It takes Parameters and
   nothing else: no inputs, no outputs, no handler. In the data model it is a
   WorkflowRevision with schemas.parameters and parameters, and no handler URI.
   The UI renders a config form and version history, no run button. There is no
   invoke()/serve() on the returned handle.

This is where dropping the class is the clearest win: the class version is an
empty class body with three methods conspicuously *not* implemented. Here it is
a single call with one argument — there is no runnable, so there is nothing to
leave blank.

This generalizes prompt management to arbitrary typed config: prompts, rubrics,
routing tables, guardrail lists, feature flags for the LLM layer.
"""

import asyncio

from pydantic import BaseModel, Field

import agenta as ag


class ConciergeConfigParams(BaseModel):
    prompt: ag.PromptTemplate = ag.PromptTemplate(
        messages=[
            ag.Message(
                role="system", content="You are the concierge of {{hotel_name}}."
            ),
        ],
        llm_config=ag.ModelConfig(model="gpt-4o-mini"),
    )
    escalation_keywords: list[str] = ["lawyer", "refund", "manager"]
    model_by_tier: dict[str, str] = Field(
        default={"free": "gpt-4o-mini", "pro": "gpt-4.1"},
        description="Routing table, editable without a deploy.",
    )


concierge_config = ag.configuration(
    slug="concierge-config",
    name="Concierge Configuration",
    description="Everything the support flow needs, versioned and deployable.",
    parameters=ConciergeConfigParams,
)


async def main():
    ag.init()

    # Same lifecycle as any workflow: commit a revision, promote it.
    await concierge_config.push()
    await concierge_config.deploy(environment="production")

    # The consuming code does not need to be an Agenta workflow at all. This
    # can run inside any service, cron job, or notebook.
    config = await concierge_config.fetch(environment="production")
    print(config.escalation_keywords)
    _model = config.model_by_tier["pro"]
    _prompt = config.prompt.format(hotel_name="Grand Agenta Hotel")

    # Sync variant for non-async codebases, cached with a TTL so it is safe to
    # call per request.
    config = concierge_config.fetch_sync(environment="production")

    # And it composes with everything else in this POC: an application can
    # reference it instead of duplicating the values (see 04_config_registry).
    class SupportParams(BaseModel):
        concierge: ConciergeConfigParams = ag.Reference(
            configuration="concierge-config",
            environment="production",
        )

    class SupportInputs(BaseModel):
        message: str

    class SupportOutputs(BaseModel):
        answer: str

    @ag.application(
        slug="support-agent",
        parameters=SupportParams,
        inputs=SupportInputs,
        outputs=SupportOutputs,
    )
    async def support_agent(
        *, inputs: SupportInputs, parameters: SupportParams
    ) -> SupportOutputs:
        # parameters.concierge is resolved and typed.
        ...


if __name__ == "__main__":
    asyncio.run(main())
