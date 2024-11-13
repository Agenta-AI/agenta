import agenta as ag
from pydantic import BaseModel, Field
from agenta.sdk.assets import supported_llm_models
from typing import Annotated
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from openai import OpenAI
import asyncio

ag.init()


openai = OpenAI()


OpenAIInstrumentor().instrument()


class MyConfig(BaseModel):
    temperature: float = Field(default=0.2, le=1, ge=0)
    model: Annotated[str, ag.MultipleChoice(choices=supported_llm_models)] = Field(
        default="gpt-3.5-turbo"
    )
    max_tokens: int = Field(default=-1, ge=-1, le=4000)
    prompt_system: str = Field(default="system prompt")
    multiselect: Annotated[str, ag.MultipleChoice(choices=["a", "b", "c"])] = Field(
        default="a"
    )


@ag.instrument(spankind="WORKFLOW")
async def openai_workflow(topic: str, genre: str):
    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": f"Write a short {genre} story about {topic}."},
        ],
    )

    return response.choices[0].message.content


if __name__ == "__main__":
    asyncio.run(openai_workflow(topic="df", genre="d"))
