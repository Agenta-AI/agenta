import agenta as ag
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import Annotated

client = OpenAI()

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()


class Prompt(BaseModel):
    prompt_template: str = Field(default=default_prompt)
    model_config = {
        "json_schema_extra": {
            "x-component-type": "prompt-playground",
            "x-component-props": {
                "supportedModels": ["gpt-3", "gpt-4"],
                "allowTemplating": True,
            },
        }
    }


class Message(BaseModel):
    role: str = Field(default="user")
    content: str = Field(default="")
    model_config = {
        "json_schema_extra": {
            "x-component-type": "message",
            "x-component-props": {
                "supportedModels": ["gpt-3", "gpt-4"],
                "allowTemplating": True,
            },
        }
    }


class BabyConfig(BaseModel):
    temperature: float = Field(default=0.2)
    prompt_template: str = Field(default=default_prompt)
    model: Annotated[str, ag.MultipleChoice(choices=["asd", "asd2"])] = Field(
        default="asd"
    )
    prompt: Prompt = Field(default=Prompt())


@ag.route("/", config_schema=BabyConfig)
def generate(country: str, gender: str, messages: Message) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.
    """
    config = ag.ConfigManager.get_from_route(schema=BabyConfig)
    prompt = config.prompt_template.format(country=country, gender=gender)

    chat_completion = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
        temperature=config.temperature,
    )
    token_usage = chat_completion.usage.dict()
    return {
        "message": chat_completion.choices[0].message.content,
        **{"usage": token_usage},
        "cost": ag.calculate_token_usage("gpt-3.5-turbo", token_usage),
    }
