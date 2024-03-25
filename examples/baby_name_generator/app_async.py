import agenta as ag
from openai import AsyncOpenAI

client = AsyncOpenAI()

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.2), prompt_template=ag.TextParam(default_prompt)
)


tracing = ag.llm_tracing()


@ag.span(tracing, event_type="llm_request")  # su types are: llm_request, embedding
async def llm_call(prompt):
    chat_completion = await client.chat.completions.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}]
    )
    tracing.set_span_attribute(
        "model", name="gpt-3.5-turbo"
    )  # translate to {"model": {"name": "gpt-3.5-turbo"}}
    return {
        "message": chat_completion.choices[0].message.content,
        "usage": chat_completion.usage.dict(),
    }


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
    response = await llm_call(prompt=prompt)
    return {
        "message": response["message"],
        "usage": response["usage"],
        "cost": ag.calculate_token_usage("gpt-3.5-turbo", response["usage"]),
    }
