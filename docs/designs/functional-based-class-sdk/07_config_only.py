"""ag.Configuration as sugar over the functional core. (POC, does not run.)

Diff this against ../function-based-sdk/07_config_only.py (functional original)
and ../class-based-sdk/07_config_only.py (class proposal).

A configuration has Parameters and nothing else: no Inputs, no Outputs, no
runnable. In 00_core.py that is just `_handler_name = None` and
`has_handler=False` — the Workflow base registers schemas + parameters and skips
the handler entirely. No empty `run()`/`evaluate()` to leave conspicuously
unimplemented.

The fetch helpers (`afetch`, `fetch`) are config-only conveniences, added here
as a thin subclass rather than baked into the shared base.

PART B is ../class-based-sdk/07_config_only.py running verbatim on the shim.
"""

from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

import agenta as ag

from core import Application  # 00_core.py — for the inline SupportAgent in main()
from core import Configuration as _Configuration  # 00_core.py, has_handler=False

# =========================================================================
# PART A — config-only fetch helpers over the core Configuration front-end,
# plus binding ag.Application for the SupportAgent reference in PART B.
# =========================================================================


class Configuration(_Configuration):
    @classmethod
    async def afetch(cls, **k):
        return await cls._handle.fetch(**k)

    @classmethod
    def fetch(cls, **k):
        return cls._handle.fetch_sync(**k)


ag.Configuration = Configuration  # type: ignore[attr-defined]
ag.Application = Application  # type: ignore[attr-defined]


# =========================================================================
# PART B — ../class-based-sdk/07_config_only.py, verbatim, on the shim.
# =========================================================================


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

    await ConciergeConfig.apush()
    await ConciergeConfig.adeploy(environment="production")

    config = await ConciergeConfig.afetch(environment="production")
    print(config.escalation_keywords)
    _model = config.model_by_tier["pro"]
    _prompt = config.prompt.format(hotel_name="Grand Agenta Hotel")

    config = ConciergeConfig.fetch(environment="production")

    # An application can reference the config instead of duplicating values.
    # ConciergeConfig.Parameters is reachable because the shim keeps the inner
    # class as a plain attribute — same as the native class proposal.
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
