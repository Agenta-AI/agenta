from typing import Dict, Any, List
import agenta as ag
from supported_llm_models import get_all_supported_llm_models
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
ag.config.default(
    temperature=ag.FloatParam(0.2),
    model=ag.GroupedMultipleChoiceParam(
        default="gpt-3.5-turbo", choices=get_all_supported_llm_models()
    ),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(SYSTEM_PROMPT),
)


async def llm_call(messages: List[Dict[str, Any]], max_tokens: int):
    chat_completion = await litellm.acompletion(
        model=ag.config.model,
        messages=messages,
        temperature=ag.config.temperature,
        max_tokens=max_tokens,
    )
    token_usage = chat_completion.usage.dict()
    return {
        "usage": token_usage,
        "message": chat_completion.choices[0].message.content,
        "cost": litellm.cost_calculator.completion_cost(
            completion_response=chat_completion, model=ag.config.model
        ),
    }


@ag.entrypoint
@ag.instrument()
async def chat(inputs: ag.MessagesInput = ag.MessagesInput()) -> Dict[str, Any]:
    messages = [{"role": "system", "content": ag.config.prompt_system}] + inputs
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    response = await llm_call(
        messages=messages,
        max_tokens=max_tokens,
    )
    return {
        "message": response["message"],
        "usage": response.get("usage", None),
        "cost": response.get("cost", None),
    }
