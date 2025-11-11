import litellm
import agenta as ag


ag.init()


@ag.instrument()
async def agenerate_completion():
    litellm.callbacks = [ag.callbacks.litellm_handler()]

    messages = [
        {
            "role": "user",
            "content": "Hey, how's it going? please respond in a in German.",
        }
    ]

    response = await litellm.acompletion(
        model="gpt-4-turbo",
        messages=messages,
        stream=True,
    )

    chat_completion = ""
    async for part in response:
        print(part.choices[0].delta.content)
        chat_completion += part.choices[0].delta.content or ""

    print(chat_completion)

    return chat_completion


@ag.instrument()
def generate_completion():
    litellm.callbacks = [ag.callbacks.litellm_handler()]

    messages = [
        {
            "role": "user",
            "content": "Hey, how's it going? please respond in a in Spanish.",
        }
    ]

    response = litellm.completion(
        model="gpt-4-turbo",
        messages=messages,
        stream=True,
    )

    chat_completion = ""
    for part in response:
        print(part.choices[0].delta.content)
        chat_completion += part.choices[0].delta.content or ""

    print(chat_completion)

    return chat_completion


if __name__ == "__main__":
    import asyncio

    asyncio.run(agenerate_completion())
    # generate_completion()
