import agenta as ag
from pydantic import BaseModel, Field
from typing import Annotated

# AGENTA_MODE = TRUE
default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init(config_fname="config.toml")

# To add to our types
# Option 1


class MyConfigSchema(BaseModel):  # <- the app
    prompt_template: str = Field(default=default_prompt)
    bool_param: bool = Field(default=True)
    int_param: int = Field(default=1, ge=1, le=5)
    float_param: float = Field(default=1.0, gt=0, lt=10)
    multiple: Annotated[str, ag.MultipleChoice(["gpt-3", "gpt-5"])] = Field(
        default="gpt3"
    )
    # multiple: Literal["gpt-3", "gpt-5"] = Field(default="gpt-3")
    grouped_multiple: Annotated[
        str,
        ag.MultipleChoice({"openai": ["gpt-3", "gpt-5"], "azure": ["gpt-5", "gpt-3"]}),
    ] = Field(default="gpt3")

    class Settings:
        app_name: str = "myapp"


config = MyConfigSchema()


@ag.route(path="/", config=config)  # side effects
def generate(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.`
    """

    prompt = config.prompt_template.format(country=country, gender=gender)

    return {
        "message": f"mock output for {prompt}",
        **{"usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20}},
        "cost": 0.01,
    }
