# /// script
# dependencies = [
#   "agenta",
#   "openai",
#   "litellm",
#   "openinference-instrumentation-openai",
#   "openinference-instrumentation-litellm",
# ]
# ///

import asyncio
import json
import os

import agenta as ag
import litellm
from openinference.instrumentation.litellm import LiteLLMInstrumentor
from openinference.instrumentation.openai import OpenAIInstrumentor
from openai import AsyncOpenAI


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_messages() -> list[dict[str, str]]:
    return [
        {"role": "system", "content": "You are an expert in geography."},
        {"role": "user", "content": "What is the capital of test?"},
    ]


def get_long_conversation_messages() -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "You are a careful travel advisor. Keep prior context, and when asked for a final "
                "answer, provide a detailed and structured response."
            ),
        }
    ]

    user_messages = [
        "I am planning a 12-day trip in Europe in late spring and I care about food, walkable neighborhoods, and museums.",
        "My budget is moderate, and I prefer trains over flights when possible because I want scenic routes and fewer airport transfers.",
        "I like cities with historic centers, but I also want at least one quieter day near nature or a waterfront promenade.",
        "Please avoid overly touristy restaurant zones and suggest where locals usually eat lunch at fair prices.",
        "I wake up early and enjoy morning walks, so I'd like recommendations for sunrise spots and good coffee nearby.",
        "I am vegetarian most days, but I occasionally eat seafood; please make sure options are easy to find in each city.",
        "I also need internet-friendly cafes because I might do a bit of remote work in two afternoons during the trip.",
        "I am interested in architecture and contemporary art, and I can handle full museum days if they are worth it.",
        "Please keep hotel transfers simple because I will carry one medium suitcase and a backpack on trains.",
        "For the final plan, include day-by-day pacing, practical train segments, and a few weather fallback activities.",
    ]

    assistant_messages = [
        "Great constraints. A balanced route is possible by combining two major cultural capitals with one slower coastal city. We can optimize station-to-hotel transfer times and avoid fragmented travel days.",
        "Understood on trains. I will prioritize direct rail legs where possible and keep transfer windows practical so you are not rushing between platforms.",
        "For your quieter day, we can include a waterfront neighborhood with gardens and easy pedestrian paths. I will avoid overloading that day so it feels restorative.",
        "I will flag tourist-heavy food streets and replace them with neighborhood markets, bistros, and lunch counters where locals tend to eat.",
        "I will include sunrise walk loops with nearby specialty coffee options in each city so your mornings feel intentional and low-stress.",
        "I will ensure vegetarian-first recommendations and add optional seafood alternatives so meal planning remains flexible.",
        "I'll provide two reliable cafe-work blocks with strong Wi-Fi and seating comfort, plus backup options in case of crowding.",
        "I will build architecture and contemporary art anchors into the route, balancing iconic institutions with less crowded alternatives.",
        "I'll keep accommodations close to major stations or direct transit lines, minimizing luggage friction across city changes.",
    ]

    for idx, user_msg in enumerate(user_messages):
        messages.append({"role": "user", "content": user_msg})
        if idx < len(assistant_messages):
            messages.append({"role": "assistant", "content": assistant_messages[idx]})

    messages.append(
        {
            "role": "user",
            "content": (
                "Now give me the final detailed itinerary in prose: include daily rhythm, food strategy, "
                "museum highlights, scenic train notes, and practical tips. Make it thorough and fairly long."
            ),
        }
    )

    return messages


def get_json_mode_messages() -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are a data assistant. Always return valid JSON only with no markdown and no extra text."
            ),
        },
        {
            "role": "user",
            "content": (
                "Return JSON for a travel summary with keys: destination, duration_days, top_highlights, "
                "estimated_budget_usd, and weather_notes. Include realistic values."
            ),
        },
    ]


def print_preview(label: str, content: str) -> None:
    preview = content[:320].replace("\n", " ")
    suffix = "..." if len(content) > 320 else ""
    print(f"[{label}] {preview}{suffix}")


async def main() -> None:
    require_env("AGENTA_HOST")
    require_env("OPENAI_API_KEY")

    model = os.getenv("MODEL", "gpt-4o-mini")

    ag.init()
    OpenAIInstrumentor().instrument()
    LiteLLMInstrumentor().instrument()

    openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    @ag.instrument(spankind="WORKFLOW")
    async def run_openai_path(messages: list[dict[str, str]]) -> str:
        response = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        print(f"[openai] {content}")
        return content

    @ag.instrument(spankind="WORKFLOW")
    async def run_litellm_path(messages: list[dict[str, str]]) -> str:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        print(f"[litellm] {content}")
        return content

    @ag.instrument(spankind="WORKFLOW")
    async def run_openai_long_conversation(messages: list[dict[str, str]]) -> str:
        response = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        print_preview("openai-long", content)
        return content

    @ag.instrument(spankind="WORKFLOW")
    async def run_litellm_long_conversation(messages: list[dict[str, str]]) -> str:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
        )
        content = response.choices[0].message.content or ""
        print_preview("litellm-long", content)
        return content

    @ag.instrument(spankind="WORKFLOW")
    async def run_openai_json_mode(messages: list[dict[str, str]]) -> str:
        response = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        print_preview("openai-json", content)
        json.loads(content)
        return content

    @ag.instrument(spankind="WORKFLOW")
    async def run_litellm_json_mode(messages: list[dict[str, str]]) -> str:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or ""
        print_preview("litellm-json", content)
        json.loads(content)
        return content

    basic_messages = get_messages()
    long_messages = get_long_conversation_messages()
    json_messages = get_json_mode_messages()

    await run_openai_path(basic_messages)
    await run_litellm_path(basic_messages)
    await run_openai_long_conversation(long_messages)
    await run_litellm_long_conversation(long_messages)
    await run_openai_json_mode(json_messages)
    await run_litellm_json_mode(json_messages)

    print("Done. Inspect traces in Agenta for all six workflow runs.")


if __name__ == "__main__":
    asyncio.run(main())
