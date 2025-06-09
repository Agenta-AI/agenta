import asyncio

import agenta as ag

from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from openai import OpenAI

ag.init(
    host="http://localhost",
    # api_key="...",
)


openai = OpenAI()


OpenAIInstrumentor().instrument()


if __name__ == "__main__":

    async def main():
        topic = "witches"
        genre = "comedy"

        openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {
                    "role": "user",
                    "content": f"Write a short {genre} story about {topic}.",
                },
            ],
        )

        invocation_link = ag.tracing.build_invocation_link()

        print()
        print("invocation link:", invocation_link)
        print()

    asyncio.run(main())
