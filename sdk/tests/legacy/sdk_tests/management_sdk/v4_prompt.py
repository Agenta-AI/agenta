from enum import Enum
from typing import List, Union, Dict
from dataclasses import dataclass
import pdb
import agenta as ag
from agenta.sdk.managers.config import ConfigManager
from agenta import FloatParam, TextParam
from pydantic import BaseModel, Field
from typing import Annotated
from typing import Literal


# AGENTA_MODE = TRUE
default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init(config_fname="config.toml")

# To add to our types
# Option 1


# class MyConfigSchema(BaseModel):  # <- the app
#     prompt_template: str = Field(default=default_prompt)
#     bool_param: bool = Field(default=True)
#     int_param: int = Field(default=1, ge=1, le=5)
#     float_param: float = Field(default=1.0, gt=0, lt=10)
#     multiple: Annotated[str, ag.MultipleChoice(["gpt-3", "gpt-5"])] = Field(default="gpt3")
#     # multiple: Literal["gpt-3", "gpt-5"] = Field(default="gpt-3")
#     grouped_multiple: Annotated[str, ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]})] = Field(default="gpt3")

#     class Settings:
#         app_name: str = 'myapp'


class Prompt(BaseModel):
    prompt_template: str = Field(default=default_prompt)
    bool_param: bool = Field(default=True)
    int_param: int = Field(default=1, ge=1, le=5)
    float_param: float = Field(default=1.0, gt=0, lt=10)
    grouped_multiple: Annotated[
        str,
        ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]}),
    ] = Field(default="gpt3")


class MyConfigSchema(BaseModel):  # <- the app
    prompt: Prompt = Field(default=Prompt())

    class settings:
        app_name: str = "myapp"


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
    # if os.environ.get("AGENTA_CLOUD"):
    # config = ag.ConfigLoader.from_route(MyConfigSchema)
    # config = ag.ConfigLoader.from_backend(MyConfigSchema)
    # config = ag.ConfigLoader.from_file(MyConfigSchema)
    # config = ConfigManager.from_route(MyConfigSchema)
    config = MyConfigSchema()
    # config = ConfigManager.from_backend(MyConfigSchema)
    prompt = config.prompt.prompt_template.format(country=country, gender=gender)

    return {
        "message": f"mock output for {prompt}",
        **{"usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}},
        "cost": 0.01,
    }
