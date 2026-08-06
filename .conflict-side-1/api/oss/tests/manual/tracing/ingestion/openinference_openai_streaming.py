# /// script
# dependencies = ["agenta", "openinference-instrumentation-openai", "openai"]
# ///
import agenta as ag
from dotenv import load_dotenv
from openinference.instrumentation.openai import OpenAIInstrumentor
from openai import OpenAI


load_dotenv(override=True)


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
        stream=True,  # Enable streaming
    )

    # Handle the streaming response properly
    for chunk in response:
        if chunk.choices[0].delta.content is not None:
            yield chunk.choices[0].delta.content


if __name__ == "__main__":
    import asyncio

    async def main():
        print("Generating joke...")
        async for chunk in rag(topic="AI", genre="hilarious"):
            print(chunk, end="", flush=True)
        print()  # New line after completion

    asyncio.run(main())
