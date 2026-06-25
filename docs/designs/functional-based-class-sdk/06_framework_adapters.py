"""Framework adapters on the functional core. (POC, does not run.)

Diff against ../function-based-sdk/06_framework_adapters.py and
../class-based-sdk/06_framework_adapters.py.

The manual tier (a plain ag.Application subclass that builds the framework agent
inside run()) works on the shim unchanged — shown below. The factory tier
(ag.ext.openai_agents.Application) and automatic tier (ag.Application.from_agent)
are framework-specific bases the SDK ships; on this core they are additional
WorkflowFunction.make(...) front-ends that set the right flags and adapter. They
all compile to the same Workflow, so they are noted here rather than restated.
"""

import asyncio

from pydantic_ai import Agent as PydanticAgent  # noqa: E402 (not installed)
from pydantic import BaseModel

import agenta as ag

from application import HotelAgent  # noqa: F401 — binds ag.Application from 00_core


# Tier 1: MANUAL. Plain ag.Application, framework inside run(). The agent is
# rebuilt per call from parameters, so the source of truth stays in Agenta.
class HotelAgentManual(ag.Application):
    slug = "hotel-agent-pydantic-ai"
    name = "Hotel Agent (Pydantic AI, manual)"

    class Parameters(BaseModel):
        model: str = "openai:gpt-4o-mini"
        instructions: str = "You are the concierge of {{hotel_name}}. Be brief."
        hotel_name: str = "Grand Agenta Hotel"

    class Inputs(BaseModel):
        message: str

    class Outputs(BaseModel):
        answer: str

    async def run(self, *, inputs: Inputs, parameters: Parameters) -> Outputs:
        agent = PydanticAgent(
            parameters.model,
            system_prompt=ag.render(
                parameters.instructions, hotel_name=parameters.hotel_name
            ),
        )
        result = await agent.run(inputs.message)
        return self.Outputs(answer=result.output)


# Tier 2 (FACTORY) and Tier 3 (AUTOMATIC) are framework-specific front-ends that
# the SDK ships on top of the same Workflow base:
#
#   ag.ext.openai_agents.application(build=...)   -> WorkflowFunction.make(
#       handler=<base runs build()>, flags=is_application, ...)
#   ag.from_agent(agent, slug=...)                -> introspect agent, then the
#       same WorkflowFunction.make(...)
#
# Both yield a Workflow identical in kind to the manual tier. See the function
# folder's 06 for the decorator spelling; the class folder's 06 for the subclass
# spelling. They converge here.


async def main():
    ag.init()
    await HotelAgentManual.apush()
    agent = HotelAgentManual(parameters={"model": "openai:gpt-4.1"})
    await agent(message="Do you have a pool?")


if __name__ == "__main__":
    asyncio.run(main())
