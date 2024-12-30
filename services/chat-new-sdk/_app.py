from typing import Annotated, Any, Dict, List

import agenta as ag
from agenta.sdk.assets import supported_llm_models
from pydantic import BaseModel, Field
import os

# Import mock if MOCK_LLM environment variable is set
if os.getenv("MOCK_LLM", True):
    from mock_litellm import MockLiteLLM

    litellm = MockLiteLLM()
else:
    import litellm

    litellm.drop_params = True
    litellm.callbacks = [ag.callbacks.litellm_handler()]

SYSTEM_PROMPT = "You have expertise in offering technical ideas to startups."

ag.init()


class MyConfig(BaseModel):
    temperature: float = Field(default=0.2, le=1, ge=0)
    model: str = ag.MCField(default="gpt-3.5-turbo", choices=supported_llm_models)
    max_tokens: int = Field(default=-1, ge=-1, le=4000)
    prompt_system: str = Field(default=SYSTEM_PROMPT)


@ag.instrument(spankind="llm")
async def llm_call(messages: List[Dict[str, Any]], maxtokens):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    chat_completion = await litellm.acompletion(
        model=config.model,
        messages=messages,
        temperature=config.temperature,
        max_tokens=maxtokens,
    )
    token_usage = chat_completion.usage.dict()
    return {
        "usage": token_usage,
        "message": chat_completion.choices[0].message.content,
        "cost": litellm.cost_calculator.completion_cost(
            completion_response=chat_completion, model=config.model
        ),
    }


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def chat(inputs: ag.MessagesInput = ag.MessagesInput()) -> Dict[str, Any]:
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    messages = [{"role": "system", "content": config.prompt_system}] + inputs
    max_tokens = config.max_tokens if config.max_tokens != -1 else None
    response = await llm_call(
        messages=messages,
        maxtokens=max_tokens,
    )
    return {
        "message": response["message"],
        "usage": response.get("usage", None),
        "cost": response.get("cost", None),
    }
