import agenta as ag
from agenta import FloatParam, TextParam
from openai import AsyncOpenAI

client = AsyncOpenAI()

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init(app_name="aat", base_name="app_async_trace")
ag.config.default(
    temperature=FloatParam(0.2), prompt_template=TextParam(default_prompt)
)


@ag.entrypoint
async def generate(country: str, gender: str):
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
    prompt_output = chat_completion.choices[0].message.content
    prompt_cost = ag.calculate_token_usage("gpt-3.5-turbo", token_usage)
    await ag.trace(
        **{
            **token_usage,
            "meta": token_usage,
            "inputs": ["country", "gender"],
            "outputs": [prompt_output],
            "prompt_template": ag.config.prompt_template,
            "cost": prompt_cost,
        },
    )
    return {
        "message": prompt_output,
        **{"usage": token_usage},
        "cost": prompt_cost,
    }
