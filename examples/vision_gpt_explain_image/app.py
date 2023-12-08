import agenta as ag
from openai import OpenAI


client = OpenAI()


SYSTEM_PROMPT = "You are an expert in reading images you look into details, you answer in accurate language."
HUMAN_PROMPT = "Please compare two images"

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.5, 0, 1),
    max_tokens=ag.IntParam(300, 1, 4000),
    prompt_system=ag.TextParam(SYSTEM_PROMPT),
    prompt_human=ag.TextParam(HUMAN_PROMPT),
)


@ag.entrypoint
def explain(
    image_one: ag.FileInputURL,
    image_two: ag.FileInputURL,
) -> str:
    messages = [{"role": "system", "content": ag.config.prompt_system}] + [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": ag.config.prompt_human},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_one,
                    },
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_two,
                    },
                },
            ],
        }
    ]
    chat_completion = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=messages,
        max_tokens=ag.config.max_tokens,
    )
    return chat_completion.choices[0].message.content
