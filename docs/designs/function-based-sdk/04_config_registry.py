"""Pulling configurations from Agenta and referencing them. (POC, does not run.)

Three patterns, identical to the class proposal:
1. Fetch deployed parameters as a typed object.
2. Bind a handle to an environment, so traces link back to the deployed
   revision automatically.
3. Reference a managed config from inside another application's Parameters.
   The resolver middleware fetches the referenced revision at invoke time.

The only difference from the class version: "bind to environment" is the same
`.pin`-family operation as everything else — `.from_registry()` returns a
handle pinned to deployed parameters, instead of a freshly constructed
instance. One mechanism, not two.
"""

import asyncio

from pydantic import BaseModel

import agenta as ag

from application import Parameters as HotelParameters  # 01_application.py
from application import hotel_agent  # 01_application.py


async def main():
    ag.init()

    # --- 1. Fetch deployed parameters, typed and validated -----------------
    # Replaces ConfigManager.get_from_registry + manual dict access. The
    # return value is a HotelParameters instance, so typos and schema drift
    # fail loudly here instead of deep inside the app.
    params = await hotel_agent.fetch_parameters(environment="production")
    print(params.prompt.messages[0].content)
    print(params.hotel_name, params.top_k)

    # The Parameters model is just a module-level type. Referencing it as a
    # type needs no `Class.Parameters` namespacing — you import it.
    assert isinstance(params, HotelParameters)

    # Specific variant or revision instead of an environment:
    _candidate = await hotel_agent.fetch_parameters(variant="experiment-1")

    # --- 2. Bind a handle to a deployed revision ---------------------------
    # Parameters are pulled from the registry and baked into the returned
    # handle (a partial, like .pin). Every trace it produces carries
    # application/variant/environment references. No manual
    # ag.tracing.store_refs calls.
    agent = await hotel_agent.from_registry(environment="production")
    _result = await agent(message="Do you have a pool?")

    # The invocation link (trace_id + span_id) is available for feedback and
    # annotation flows, same as build_invocation_link today.
    print(agent.last_invocation.trace_id)

    # --- 3. Reference managed configs from another application -------------
    class RouterParams(BaseModel):
        # An inline default, editable in the playground.
        routing_prompt: ag.PromptTemplate = ag.PromptTemplate(
            messages=[ag.Message(role="system", content="Route the request.")],
        )
        # A reference instead of a value. The resolver middleware fetches the
        # deployed revision of hotel-agent's prompt at invoke time, so this app
        # always follows what is live in production. The playground renders a
        # revision picker for it.
        concierge_prompt: ag.PromptTemplate = ag.Reference(
            application="hotel-agent",
            environment="production",
            key="prompt",
        )

    class RouterInputs(BaseModel):
        message: str

    class RouterOutputs(BaseModel):
        answer: str
        route: str

    @ag.application(
        slug="router-agent",
        parameters=RouterParams,
        inputs=RouterInputs,
        outputs=RouterOutputs,
    )
    async def router_agent(
        *, inputs: RouterInputs, parameters: RouterParams
    ) -> RouterOutputs:
        # parameters.concierge_prompt is already resolved here.
        ...

    # --- Lifecycle: push and deploy -----------------------------------------
    # push() commits a new revision with the schemas and defaults compiled from
    # the decorator. deploy() promotes it to an environment.
    revision_id = await hotel_agent.push()
    await hotel_agent.deploy(revision=revision_id, environment="staging")


if __name__ == "__main__":
    asyncio.run(main())
