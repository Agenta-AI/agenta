from typing import Dict

import agenta as ag
import litellm
from agenta.sdk.types import PromptTemplate
from pydantic import BaseModel, Field

litellm.drop_params = True
litellm.callbacks = [ag.callbacks.litellm_handler()]

ag.init()


class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {country}?",
        )
    )


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    inputs: Dict[str, str],
):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    response = await litellm.acompletion(
        **config.prompt.format(**inputs).to_openai_kwargs()
    )
    return response.choices[0].message.__dict__
