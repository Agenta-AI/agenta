from typing import Dict, Any, List, Annotated
import agenta as ag
import litellm
from pydantic import BaseModel, Field

litellm.drop_params = True

SYSTEM_PROMPT = "You have expertise in offering technical ideas to startups."
supported_llm_models = {
    "Mistral AI": [
        "mistral/mistral-tiny",
        "mistral/mistral-small",
        "mistral/mistral-medium",
        "mistral/mistral-large-latest",
    ],
    "Open AI": [
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo",
        "gpt-4",
        "gpt-4o",
        "gpt-4-1106-preview",
    ],
    "Gemini": [
        "gemini/gemini-1.5-pro-latest",
    ],
    "Cohere": [
        "cohere/command-light",
        "cohere/command-r-plus",
        "cohere/command-nightly",
    ],
    "Anthropic": [
        "anthropic/claude-3.5",
        "anthropic/claude-3",
        "anthropic/claude-2.1",
        "anthropic/claude-2",
        "anthropic/claude-instant-1.2",
        "anthropic/claude-instant-1",
    ],
    "Anyscale": [
        "anyscale/meta-llama/Llama-2-13b-chat-hf",
        "anyscale/meta-llama/Llama-2-70b-chat-hf",
    ],
    "Perplexity AI": [
        "perplexity/pplx-7b-chat",
        "perplexity/pplx-70b-chat",
        "perplexity/pplx-7b-online",
        "perplexity/pplx-70b-online",
    ],
    "DeepInfra": [
        "deepinfra/meta-llama/Llama-2-70b-chat-hf",
        "deepinfra/meta-llama/Llama-2-13b-chat-hf",
        "deepinfra/codellama/CodeLlama-34b-Instruct-hf",
        "deepinfra/mistralai/Mistral-7B-Instruct-v0.1",
        "deepinfra/jondurbin/airoboros-l2-70b-gpt4-1.4.1",
    ],
    "Together AI": [
        "together_ai/togethercomputer/llama-2-70b-chat",
        "together_ai/togethercomputer/llama-2-70b",
        "together_ai/togethercomputer/LLaMA-2-7B-32K",
        "together_ai/togethercomputer/Llama-2-7B-32K-Instruct",
        "together_ai/togethercomputer/llama-2-7b",
        "together_ai/togethercomputer/alpaca-7b",
        "together_ai/togethercomputer/CodeLlama-34b-Instruct",
        "together_ai/togethercomputer/CodeLlama-34b-Python",
        "together_ai/WizardLM/WizardCoder-Python-34B-V1.0",
        "together_ai/NousResearch/Nous-Hermes-Llama2-13b",
        "together_ai/Austism/chronos-hermes-13b",
    ],
    "Aleph Alpha": [
        "luminous-base",
        "luminous-base-control",
        "luminous-extended-control",
        "luminous-supreme",
    ],
    "OpenRouter": [
        "openrouter/openai/gpt-3.5-turbo",
        "openrouter/openai/gpt-3.5-turbo-16k",
        "openrouter/anthropic/claude-instant-v1",
        "openrouter/google/palm-2-chat-bison",
        "openrouter/google/palm-2-codechat-bison",
        "openrouter/meta-llama/llama-2-13b-chat",
        "openrouter/meta-llama/llama-2-70b-chat",
    ],
    "Groq": [
        "groq/llama3-8b-8192",
        "groq/llama3-70b-8192",
        "groq/llama2-70b-4096",
        "groq/mixtral-8x7b-32768",
        "groq/gemma-7b-it",
    ],
}

ag.init()


class MyConfig(BaseModel):
    temperature: float = Field(default=0.2, le=1, ge=0)
    model: Annotated[str, ag.MultipleChoice(choices=supported_llm_models)] = Field(
        default="gpt-3.5-turbo"
    )
    max_tokens: int = Field(default=-1, ge=-1, le=4000)
    prompt_system: str = Field(default=SYSTEM_PROMPT)
    multiselect: Annotated[str, ag.MultipleChoice(choices=["a", "b", "c"])] = Field(
        default="a"
    )


@ag.route("/llm_call", config_schema=MyConfig)
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
