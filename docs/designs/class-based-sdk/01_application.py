"""An application as a class. (POC, does not run.)

The class is the workflow:
- `Parameters`, `Inputs`, `Outputs` compile to the revision's JSON schemas.
- `run()` is the handler. It is auto-instrumented: one root span per invocation
  with inputs, outputs, cost, and token capture.
- `stream()` is optional. Declare it only if the app can stream.
- `slug`, `name`, `description` map to the workflow identity on the platform.
"""

import asyncio
from typing import AsyncIterator

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

import agenta as ag


class HotelAgent(ag.Application):
    slug = "hotel-agent"
    name = "Hotel Agent"
    description = "Concierge agent that answers questions about the hotel."

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

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Instance state is for request-independent resources only (clients,
        # retrievers, indexes). Parameters arrive per request, not here.
        self.client = AsyncOpenAI()

    async def run(self, *, inputs: Inputs, parameters: Parameters) -> Outputs:
        documents = await self.retrieve(query=inputs.message, top_k=parameters.top_k)

        prompt = parameters.prompt.format(
            hotel_name=parameters.hotel_name,
            message=inputs.message,
        )
        response = await self.client.chat.completions.create(
            **prompt.to_openai_kwargs()
        )

        return self.Outputs(
            answer=response.choices[0].message.content,
            sources=[doc["id"] for doc in documents],
        )

    # Nested steps use @ag.instrument as today. They show up as child spans
    # under the invocation span.
    @ag.instrument(type="retriever")
    async def retrieve(self, *, query: str, top_k: int) -> list[dict]:
        return [{"id": "faq-12", "text": "The pool is open 7am to 10pm."}]

    # Optional. When declared, the server can negotiate streaming responses
    # (SSE / NDJSON) from the Accept header. Batch callers still get run().
    async def stream(
        self, *, inputs: Inputs, parameters: Parameters
    ) -> AsyncIterator[str]:
        prompt = parameters.prompt.format(
            hotel_name=parameters.hotel_name,
            message=inputs.message,
        )
        stream = await self.client.chat.completions.create(
            stream=True, **prompt.to_openai_kwargs()
        )
        async for chunk in stream:
            yield chunk.choices[0].delta.content or ""


async def main():
    ag.init()

    # Local typed call. Traced like any decorated handler today.
    agent = HotelAgent()
    result = await agent(message="Do you have a pool?")
    print(result.answer, result.sources)

    # Pin a configuration. These values become revision.data.parameters
    # when the class is pushed.
    boutique = HotelAgent(parameters={"hotel_name": "Hotel California", "top_k": 8})
    result = await boutique(message="Can I check out any time I like?")

    # Full pipeline (vault -> resolver -> normalizer), same code path the
    # platform runs. Plain kwargs; the SDK builds the wire request internally.
    # WorkflowInvokeRequest stays as the HTTP body format for /invoke (it also
    # carries references, selector, secrets, credentials), but local callers
    # never construct it.
    _response = await agent.invoke(
        inputs={"message": "Is breakfast included?"},
        parameters={"top_k": 2},
    )

    # Inspect returns the interface. Schemas come straight from the class,
    # no signature inference.
    interface = await HotelAgent.inspect()
    print(interface.data.schemas.outputs)

    # Push to Agenta: creates or updates the application and returns the
    # new revision. Schemas and default parameters travel with it.
    revision_id = await HotelAgent.apush()
    print(f"pushed revision {revision_id}")


if __name__ == "__main__":
    asyncio.run(main())
