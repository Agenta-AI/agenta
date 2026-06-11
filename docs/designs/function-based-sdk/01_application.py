"""An application as a function. (POC, does not run.)

The function is the workflow:
- `Parameters`, `Inputs`, `Outputs` are plain models, passed to the decorator.
  They compile to the revision's JSON schemas, declared not inferred.
- The decorated function is the handler. It is auto-instrumented: one root
  span per invocation with inputs, outputs, cost, and token capture.
- `@handler.stream` is optional. Declare a second function only if the app
  can stream.
- `slug`, `name`, `description` map to the workflow identity on the platform.

`@ag.application(...)` returns a *handle*, not a bare function: it is callable
(local typed invocation) and also carries `.pin`, `.invoke`, `.inspect`,
`.push`, `.router`, `.from_registry`, `.fetch_parameters`. The handle is the
functional equivalent of a class instance.
"""

import asyncio
from typing import AsyncIterator

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

import agenta as ag

# Request-independent resources live at module scope. They are the functional
# equivalent of the class's `__init__` (clients, retrievers, indexes). They are
# built once, not per request. Parameters arrive per request, not here.
client = AsyncOpenAI()


class Parameters(BaseModel):
    """Playground-editable configuration. Becomes schemas.parameters."""

    prompt: ag.PromptTemplate = ag.PromptTemplate(
        messages=[
            ag.Message(
                role="system",
                content="You are the concierge of {{hotel_name}}. Be brief.",
            ),
            ag.Message(role="user", content="{{message}}"),
        ],
        llm_config=ag.ModelConfig(model="gpt-4o-mini", temperature=0.2),
    )
    hotel_name: str = "Grand Agenta Hotel"
    top_k: int = Field(4, ge=1, le=20, description="Documents to retrieve")


class Inputs(BaseModel):
    """Runtime inputs. Becomes schemas.inputs and the expected testset columns."""

    message: str
    persona: str = "guest"


class Outputs(BaseModel):
    """Becomes schemas.outputs. This is what evaluators receive as `outputs`."""

    answer: str
    sources: list[str] = []


# Nested steps use @ag.instrument as today. They show up as child spans under
# the invocation span. Defined before the handler so it can call them.
@ag.instrument(type="retriever")
async def retrieve(*, query: str, top_k: int) -> list[dict]:
    return [{"id": "faq-12", "text": "The pool is open 7am to 10pm."}]


@ag.application(
    slug="hotel-agent",
    name="Hotel Agent",
    description="Concierge agent that answers questions about the hotel.",
    parameters=Parameters,  # schemas declared explicitly, not inferred
    inputs=Inputs,
    outputs=Outputs,
)
async def hotel_agent(*, inputs: Inputs, parameters: Parameters) -> Outputs:
    documents = await retrieve(query=inputs.message, top_k=parameters.top_k)

    prompt = parameters.prompt.format(
        hotel_name=parameters.hotel_name,
        message=inputs.message,
    )
    response = await client.chat.completions.create(**prompt.to_openai_kwargs())

    return Outputs(
        answer=response.choices[0].message.content,
        sources=[doc["id"] for doc in documents],
    )


# Optional. When declared, the server can negotiate streaming responses
# (SSE / NDJSON) from the Accept header. Batch callers still get the handler.
# No introspection guessing whether a `stream` method exists: the handle simply
# does, or does not, have a registered streamer.
@hotel_agent.stream
async def hotel_agent_stream(
    *, inputs: Inputs, parameters: Parameters
) -> AsyncIterator[str]:
    prompt = parameters.prompt.format(
        hotel_name=parameters.hotel_name,
        message=inputs.message,
    )
    stream = await client.chat.completions.create(
        stream=True, **prompt.to_openai_kwargs()
    )
    async for chunk in stream:
        yield chunk.choices[0].delta.content or ""


async def main():
    ag.init()

    # Local typed call. Traced like any decorated handler today.
    result = await hotel_agent(message="Do you have a pool?")
    print(result.answer, result.sources)

    # Pin a configuration. `.pin()` is a functools.partial over parameters:
    # it returns a new handle with these values baked in as defaults. They
    # become revision.data.parameters when the handle is pushed. This is the
    # "constructor builder with partials" — no instance, no __init__.
    boutique = hotel_agent.pin(hotel_name="Hotel California", top_k=8)
    result = await boutique(message="Can I check out any time I like?")

    # Full pipeline (vault -> resolver -> normalizer), same code path the
    # platform runs. Plain kwargs; the SDK builds the wire request internally.
    # WorkflowInvokeRequest stays the HTTP body format for /invoke; local
    # callers never construct it.
    _response = await hotel_agent.invoke(
        inputs={"message": "Is breakfast included?"},
        parameters={"top_k": 2},
    )

    # Inspect returns the interface. Schemas come straight from the models you
    # passed to the decorator, no signature inference.
    interface = await hotel_agent.inspect()
    print(interface.data.schemas.outputs)

    # Push to Agenta: creates or updates the application and returns the new
    # revision. Schemas and default parameters travel with it.
    revision_id = await hotel_agent.push()
    print(f"pushed revision {revision_id}")


if __name__ == "__main__":
    asyncio.run(main())
