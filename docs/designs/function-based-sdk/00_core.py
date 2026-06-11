"""The foundation the function form's 01-08 sit on. (POC, does not run.)

Each peer folder has a `00_core.py` holding what its numbered files build on:

    ../class-based-sdk/00_core.py             the base CLASSES (ag.Application, ...)
    ../functional-based-class-sdk/00_core.py  those same bases on the function core
    ./00_core.py  (this file)                 the function form has NO base classes

The function form needs no base class: you decorate, you don't subclass. So this
folder's "core" is not a type hierarchy — it is the conventions the decorator
makes possible. The headline one, which the class form cannot match, is closures:
factories that keep Parameters/Inputs/Outputs (and clients, captured config)
PRIVATE to the workflow instead of public attributes on a class.

That is why this file looks different from the other two `00_core.py`: there is
no `Workflow`/`Application` base to define here. The foundation is the decorator
plus closure scoping. (The numbered files 01-08 still diff 1:1 across folders;
this file has no per-kind counterpart — it is the function form's foundation.)

== Closures: scoped, private schemas the class cannot match ==

The other files declare Parameters/Inputs/Outputs at module scope. That works,
but it leaks three types into the module namespace. A closure factory keeps them
private to the workflow — captured in the enclosing scope, invisible to the rest
of the module — while the decorator still registers them, because they are
passed to it explicitly. Registration needs the *value*, not an importable name.

This is the functional analogue of instance state, and on encapsulation it beats
the class outright:

    class:    Parameters is HotelAgent.Parameters  -> always public, always
              reachable, namespace permanently occupied.
    closure:  Parameters lives in the factory's local scope -> private by
              default, exposed only if the factory chooses to return it.

Three patterns below: fully private, selectively exposed, and a config-bound
factory that captures a deployed revision once and closes over it.
"""

from __future__ import annotations

import asyncio

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

import agenta as ag


# =========================================================================
# 1. FULLY PRIVATE. Schemas + client live inside the factory. Nothing leaks;
#    the module sees only `hotel_agent`, the handle.
# =========================================================================


def make_hotel_agent() -> ag.Workflow:
    client = AsyncOpenAI()  # captured once, like instance state — no module global

    class Parameters(BaseModel):
        hotel_name: str = "Grand Agenta Hotel"
        top_k: int = Field(4, ge=1, le=20)

    class Inputs(BaseModel):
        message: str

    class Outputs(BaseModel):
        answer: str
        sources: list[str] = []

    @ag.application(
        slug="hotel-agent",
        name="Hotel Agent",
        parameters=Parameters,  # passed by value: registered without being importable
        inputs=Inputs,
        outputs=Outputs,
    )
    async def run(*, inputs: Inputs, parameters: Parameters) -> Outputs:
        prompt = f"You are the concierge of {parameters.hotel_name}. {inputs.message}"
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
        )
        return Outputs(answer=response.choices[0].message.content, sources=[])

    return run  # the handle; Parameters/Inputs/Outputs are now unreachable


hotel_agent = make_hotel_agent()
# Parameters does not exist out here. There is no `hotel_agent.Parameters` leak,
# no module-level `Parameters` symbol. The schema still registered fine.


# =========================================================================
# 2. SELECTIVELY EXPOSED. Keep them private, but hand back exactly the ones
#    callers legitimately need (e.g. Parameters, to build a pinned config),
#    while Inputs/Outputs stay sealed. The class forces all-or-nothing: every
#    inner model is public the moment the class is.
# =========================================================================


def make_router_agent():
    class Parameters(BaseModel):
        routing_prompt: str = "Route the request."

    class Inputs(BaseModel):  # stays private
        message: str

    class Outputs(BaseModel):  # stays private
        answer: str
        route: str

    @ag.application(
        slug="router-agent", parameters=Parameters, inputs=Inputs, outputs=Outputs
    )
    async def run(*, inputs: Inputs, parameters: Parameters) -> Outputs: ...

    # Expose only what the caller needs to construct configs; seal the rest.
    return run, Parameters


router_agent, RouterParameters = make_router_agent()
_pinned = router_agent.pin(routing_prompt="Be terse.")
_typed = RouterParameters(routing_prompt="Be terse.")  # usable; Inputs/Outputs are not


# =========================================================================
# 3. CONFIG-BOUND FACTORY. Capture a deployed revision (or any resource) once,
#    close over it, and return a handle that never re-fetches. The captured
#    config is private state — the closure is the binding. With a class you'd
#    reach for __init__ + an instance attribute; the closure needs neither.
# =========================================================================


async def make_bound_agent(environment: str) -> ag.Workflow:
    # Fetched once, at factory time, then captured. Every call uses it; no
    # per-request lookup, no instance to thread it through.
    deployed = await hotel_agent.fetch_parameters(environment=environment)

    class Inputs(BaseModel):
        message: str

    class Outputs(BaseModel):
        answer: str

    @ag.application(slug="hotel-agent-bound", inputs=Inputs, outputs=Outputs)
    async def run(*, inputs: Inputs) -> Outputs:
        # `deployed` is closed over — the binding lives in scope, not in config.
        return Outputs(answer=f"[{deployed.hotel_name}] {inputs.message}")

    return run


async def main():
    ag.init()

    result = await hotel_agent(message="Do you have a pool?")
    print(result.answer)

    bound = await make_bound_agent(environment="production")
    await bound(message="Is breakfast included?")


if __name__ == "__main__":
    asyncio.run(main())
