import os
from typing import Annotated

import agenta as ag
from agenta.sdk.config_manager import ConfigManager
from pydantic import BaseModel, Field

os.environ["AGENTA_MODE"] = "true"

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init(config_fname="config.toml")


class MyConfigSchema(BaseModel):  # <- the app
    prompt_template: str = Field(default=default_prompt)
    bool_param: bool = Field(default=True)
    int_param: int = Field(default=1, ge=1, le=5)
    float_param: float = Field(default=1.0, gt=0, lt=10)
    multiple: Annotated[str, ag.MultipleChoice(["gpt-3", "gpt-5"])] = Field(default="gpt3")
    grouped_multiple: Annotated[str, ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]})] = Field(default="gpt3")



@ag.route(path="/", config_schema=MyConfigSchema)
def rag(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.`
    """
    if os.environ.get("AGENTA_MODE") == "true":
        config = ConfigManager.get_from_route(schema=MyConfigSchema)
    else:
        config = ConfigManager.get_from_backend(schema=MyConfigSchema, environment="production")
    prompt = config.prompt_template.format(country=country, gender=gender)

    return f"mock output for {prompt}"
