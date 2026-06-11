"""Configuration-only workflows: prompt management and beyond. (POC, does not run.)

Two answers to "I want the config, not the runnable":

1. Any workflow class already works that way. A pushed class registers its
   schemas and parameters on the platform; run() only executes where your
   code runs. If you never serve it, the platform side is exactly a managed,
   versioned configuration. Just call afetch_parameters() and never invoke.

2. ag.Configuration makes that intent explicit. It has Parameters and
   nothing else: no Inputs, no Outputs, no run(). In the data model it is a
   WorkflowRevision with schemas.parameters and parameters, and no handler
   URI. The UI renders a config form and version history, no run button.
   invoke() and serve() do not exist on it.

This generalizes prompt management to arbitrary typed config: prompts,
rubrics, routing tables, guardrail lists, feature flags for the LLM layer.
"""

import asyncio

from pydantic import BaseModel, Field

import agenta as ag

from core import Application, Configuration  # 00_core.py — native class bases

ag.Configuration = Configuration  # what the SDK __init__ would export
ag.Application = Application  # for the SupportAgent reference in main()


class ConciergeConfig(ag.Configuration):
    slug = "concierge-config"
    name = "Concierge Configuration"
    description = "Everything the support flow needs, versioned and deployable."

    class Parameters(BaseModel):
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


async def main():
    ag.init()

    # Same lifecycle as any workflow: commit a revision, promote it.
    await ConciergeConfig.apush()
    await ConciergeConfig.adeploy(environment="production")

    # The consuming code does not need to be an Agenta workflow at all.
    # This can run inside any service, cron job, or notebook.
    config = await ConciergeConfig.afetch(environment="production")
    print(config.escalation_keywords)
    _model = config.model_by_tier["pro"]
    _prompt = config.prompt.format(hotel_name="Grand Agenta Hotel")

    # Sync variant for non-async codebases, cached with a TTL so it is safe
    # to call per request.
    config = ConciergeConfig.fetch(environment="production")

    # And it composes with everything else in this POC: an application can
    # reference it instead of duplicating the values (see 04_config_registry).
    class SupportAgent(ag.Application):
        slug = "support-agent"

        class Parameters(BaseModel):
            concierge: ConciergeConfig.Parameters = ag.Reference(
                configuration="concierge-config",
                environment="production",
            )

        class Inputs(BaseModel):
            message: str

        class Outputs(BaseModel):
            answer: str

        async def run(self, *, inputs: Inputs, parameters: Parameters) -> Outputs:
            # parameters.concierge is resolved and typed.
            ...


if __name__ == "__main__":
    asyncio.run(main())
