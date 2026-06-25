"""Pulling configurations from Agenta and referencing them. (POC, does not run.)

Three patterns:
1. Fetch deployed parameters as a typed object.
2. Bind an instance to an environment, so traces link back to the deployed
   revision automatically.
3. Reference a managed config from inside another application's Parameters.
   The resolver middleware fetches the referenced revision at invoke time.
"""

import asyncio

from pydantic import BaseModel

import agenta as ag

from application import HotelAgent  # 01_application.py


async def main():
    ag.init()

    # --- 1. Fetch deployed parameters, typed and validated -----------------
    # Replaces ConfigManager.get_from_registry + manual dict access. The
    # return value is a HotelAgent.Parameters instance, so typos and schema
    # drift fail loudly here instead of deep inside the app.
    params = await HotelAgent.afetch_parameters(environment="production")
    print(params.prompt.messages[0].content)
    print(params.hotel_name, params.top_k)

    # Specific variant or revision instead of an environment:
    _candidate = await HotelAgent.afetch_parameters(variant="experiment-1")

    # --- 2. Bind an instance to a deployed revision -------------------------
    # Parameters are pulled from the registry, and every trace produced by
    # this instance carries application/variant/environment references. No
    # manual ag.tracing.store_refs calls.
    agent = await HotelAgent.afrom_registry(environment="production")
    _result = await agent(message="Do you have a pool?")

    # The invocation link (trace_id + span_id) is available for feedback
    # and annotation flows, same as build_invocation_link today.
    print(agent.last_invocation.trace_id)

    # --- 3. Reference managed configs from another application -------------
    class RouterAgent(ag.Application):
        slug = "router-agent"

        class Parameters(BaseModel):
            # An inline default, editable in the playground.
            routing_prompt: ag.PromptTemplate = ag.PromptTemplate(
                messages=[ag.Message(role="system", content="Route the request.")],
            )
            # A reference instead of a value. The resolver middleware fetches
            # the deployed revision of hotel-agent's prompt at invoke time, so
            # this app always follows what is live in production. The
            # playground renders a revision picker for it.
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

    # --- Lifecycle: push and deploy -----------------------------------------
    # apush() commits a new revision with the schemas and defaults compiled
    # from the class. adeploy() promotes it to an environment.
    revision_id = await HotelAgent.apush()
    await HotelAgent.adeploy(revision=revision_id, environment="staging")


if __name__ == "__main__":
    asyncio.run(main())
