import agenta as ag
import openai
from agenta import FloatParam, MessagesInput

default_prompt = (
    "Give me 10 feature ideas to implement for a food delivery company in {country}!"
)

ag.init(app_name="baby_name_generator", base_name="app")
ag.config.default(
    temperature=FloatParam(0.2),
)


@ag.entrypoint
def generate(
    country: str,
    inputs: MessagesInput,
) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.
    """

    messages = [
        {
            "role": message.role,
            "content": message.content.format(country=country),
        }
        for message in inputs.messages
    ]

    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=messages,
    )
    return chat_completion.choices[0].message.content
