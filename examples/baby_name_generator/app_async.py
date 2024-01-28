from agenta import FloatParam, TextParam
import agenta as ag
from openai import AsyncOpenAI

client = AsyncOpenAI()

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()
ag.config.default(
    temperature=FloatParam(0.2), prompt_template=TextParam(default_prompt)
)


@ag.entrypoint
async def generate(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.
    """
    prompt = ag.config.prompt_template.format(country=country, gender=gender)

    chat_completion = await client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}]
    )
    token_usage = chat_completion.usage.dict()
    return {
        "message": chat_completion.choices[0].message.content,
        **{"usage": token_usage},
        "cost": ag.calculate_token_usage("gpt-3.5-turbo", token_usage),
    }
