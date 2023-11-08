import agenta as ag
import openai
from agenta import FloatParam, MessagesInput

default_prompt = (
    "Give me 10 feature ideas to implement for a food delivery company in Nigeria!"
)

ag.init(app_name="feature_ideas", base_name="app")
ag.config.default(
    temperature=FloatParam(0.2),
)


@ag.entrypoint
def chat(
    inputs: MessagesInput = MessagesInput([{"role": "string", "content": "string"}])
) -> str:
    messages = [
        {
            "role": message["role"],
            "content": message["content"],
        }
        for message in inputs
    ]
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=messages,
    )
    return chat_completion.choices[0].message.content
