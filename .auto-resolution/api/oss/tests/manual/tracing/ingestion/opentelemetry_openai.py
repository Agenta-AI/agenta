# /// script
# dependencies = ["agenta", "opentelemetry-instrumentation-openai-v2", "openai"]
# ///
import agenta as ag
from dotenv import load_dotenv
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor
from openai import OpenAI

import os

load_dotenv(override=True)

os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "true"
ag.init()


openai = OpenAI()


OpenAIInstrumentor().instrument()


@ag.instrument(spankind="WORKFLOW")
async def rag(topic: str, genre: str):
    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": f"Write a short {genre} joke about {topic}."},
        ],
    )

    return response.choices[0].message.content


if __name__ == "__main__":
    import asyncio

    asyncio.run(rag(topic="AI", genre="hilarious"))
