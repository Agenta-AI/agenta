import agenta as ag
from openai import OpenAI
from typing import List, Dict


client = OpenAI()

ag.init(app_name="explain_image", base_name="app")
ag.config.default(
    model=ag.MultipleChoiceParam("gpt-4-vision-preview", []),
    max_tokens=ag.IntParam(300, -1, 4000),
)


def replace_image_url(
    messages: List[Dict[str, str]], image_one: str, image_two: str
) -> Dict[str, str]:
    new_message = {}
    for message in messages:
        for key, value in message.items():
            if key == "content":
                new_content = []
                for content in value:
                    if content["type"] == "image_url":
                        content["image_url"] = (
                            image_two
                            if content["image_url"] == image_one
                            else image_one
                        )
                    new_content.append(content)
                new_message[key] = new_content
            else:
                new_message[key] = value
    return new_message


@ag.entrypoint
def explain(
    image_one: ag.FileInputURL,
    image_two: ag.FileInputURL,
    inputs: ag.DictInput = ag.DictInput(default_keys=["role"]),
    messages: ag.MessagesInput = ag.MessagesInput(
        [
            {"type": "text", "text": "What are in these image?"},
        ]
    ),
) -> str:
    messages = [inputs] + [{"content": messages}]
    new_messages = replace_image_url(messages, image_one, image_two)
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    chat_completion = client.chat.completions.create(
        model=ag.config.model,
        messages=[new_messages],
        max_tokens=max_tokens,
    )
    return chat_completion.choices[0].message.content
