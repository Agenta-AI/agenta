"""Config registry — class-based example on the functional core. (POC, does not run.)

Diff against ../function-based-sdk/04_config_registry.py and
../class-based-sdk/04_config_registry.py. Importing HotelAgent from 01 binds
ag.Application (the class front-end from 00_core), so the inline RouterAgent
subclass below resolves. Lifecycle calls delegate to the functional handle.
"""

import asyncio

from pydantic import BaseModel

import agenta as ag

from application import HotelAgent  # 01_application.py — also binds ag.Application


async def main():
    ag.init()

    # 1. Fetch deployed parameters, typed and validated.
    params = await HotelAgent.afetch_parameters(environment="production")
    print(params.prompt.messages[0].content)
    print(params.hotel_name, params.top_k)

    _candidate = await HotelAgent.afetch_parameters(variant="experiment-1")

    # 2. Bind to a deployed revision (afrom_registry -> pinned handle).
    agent = await HotelAgent.afrom_registry(environment="production")
    _result = await agent(message="Do you have a pool?")
    print(agent.last_invocation.trace_id)

    # 3. Reference managed configs from another application.
    class RouterAgent(ag.Application):
        slug = "router-agent"

        class Parameters(BaseModel):
            routing_prompt: ag.PromptTemplate = ag.PromptTemplate(
                messages=[ag.Message(role="system", content="Route the request.")],
            )
            concierge_prompt: ag.PromptTemplate = ag.Reference(
                application="hotel-agent",
                environment="production",
                key="prompt",
            )

        class Inputs(BaseModel):
            message: str

        class Outputs(BaseModel):
            answer: str
            route: str

        async def run(self, *, inputs: Inputs, parameters: Parameters) -> Outputs:
            # parameters.concierge_prompt is already resolved here.
            ...

    # Lifecycle: push and deploy.
    revision_id = await HotelAgent.apush()
    await HotelAgent.adeploy(revision=revision_id, environment="staging")


if __name__ == "__main__":
    asyncio.run(main())
