from typing import Annotated, List, Union, Optional, Dict, Literal
from pydantic import BaseModel, Field, root_validator

import agenta as ag
from agenta.sdk.assets import supported_llm_models
import os
# Import mock if MOCK_LLM environment variable is set
if os.getenv("MOCK_LLM", True):
    from mock_litellm import MockLiteLLM

    litellm = MockLiteLLM()
else:
    import litellm

    litellm.drop_params = True
    litellm.callbacks = [ag.callbacks.litellm_handler()]


prompts = {
    "system_prompt": "You are an expert in geography.",
    "user_prompt": """What is the capital of {country}?""",
}

GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]


ag.init()

class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: Dict[str, str]

class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool", "function"]
    content: Optional[str] = None
    name: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    tool_call_id: Optional[str] = None

class ResponseFormat(BaseModel):
    type: Literal["text", "json_object"] = "text"
    schema: Optional[Dict] = None

class Prompts(BaseModel):
    messages: List[Message] = Field(
        default=[
            Message(role="system", content=prompts["system_prompt"]),
            Message(role="user", content=prompts["user_prompt"])
        ]
    )
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    template_format: Literal["fstring", "jinja2", "curly"] = Field(
        default="fstring",
        description="Format type for template variables: fstring {var}, jinja2 {{ var }}, or curly {{var}}"
    )
    response_format: Optional[ResponseFormat] = Field(
        default=None,
        description="Specify the format of the response (text or JSON)"
    )
    tools: Optional[List[Dict]] = Field(
        default=None,
        description="List of tools/functions the model can use"
    )
    tool_choice: Optional[Union[Literal["none", "auto"], Dict]] = Field(
        default="auto",
        description="Control which tool the model should use"
    )

    class Config:
        extra = "allow"
        schema_extra = {
            "x-prompt": True
        }

    @root_validator(pre=True)
    def init_messages(cls, values):
        if "messages" not in values:
            messages = []
            if "system_prompt" in values and values["system_prompt"]:
                messages.append(Message(role="system", content=values["system_prompt"]))
            if "user_prompt" in values and values["user_prompt"]:
                messages.append(Message(role="user", content=values["user_prompt"]))
            if messages:
                values["messages"] = messages
        return values

class MyConfig(BaseModel):
    prompt: Prompts = Field(default=Prompts())
    


@ag.instrument(spankind="llm")
async def llm_call(prompt_system: str, prompt_user: str):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    response_format = (
        {"type": "json_object"}
        if config.force_json and config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )

    max_tokens = config.max_tokens if config.max_tokens != -1 else None

    # Include frequency_penalty and presence_penalty only if supported
    completion_params = {}
    if config.model in GPT_FORMAT_RESPONSE:
        completion_params["frequency_penalty"] = config.frequence_penalty
        completion_params["presence_penalty"] = config.presence_penalty

    response = await litellm.acompletion(
        **{
            "model": config.model,
            "messages": config.prompt.messages,
            "temperature": config.temperature,
            "max_tokens": max_tokens,
            "top_p": config.top_p,
            "response_format": response_format,
            **completion_params,
        }
    )
    token_usage = response.usage.dict()
    return {
        "message": response.choices[0].message.content,
        "usage": token_usage,
        "cost": litellm.cost_calculator.completion_cost(
            completion_response=response, model=config.model
        ),
    }


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["country"]),
):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    print("popo", config)
    try:
        prompt_user = config.prompt_user.format(**inputs)
    except Exception as e:
        prompt_user = config.prompt_user
    try:
        prompt_system = config.prompt_system.format(**inputs)
    except Exception as e:
        prompt_system = config.prompt_system

    # SET MAX TOKENS - via completion()
    if config.force_json and config.model not in GPT_FORMAT_RESPONSE:
        raise ValueError(
            "Model {} does not support JSON response format".format(config.model)
        )

    response = await llm_call(prompt_system=prompt_system, prompt_user=prompt_user)
    return {
        "message": response["message"],
        "usage": response.get("usage", None),
        "cost": response.get("cost", None),
    }
