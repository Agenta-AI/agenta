import pytest

from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.types import Message, PromptTemplate

pytestmark = [pytest.mark.e2e]


def test_prompt_template_messages_roundtrip_in_variant_config(
    agenta_init, test_variant
):
    prompt = PromptTemplate(
        messages=[
            Message(role="system", content="You are a concise assistant."),
            Message(role="user", content="Say hi to {{name}}."),
        ],
        template_format="curly",
    )

    prompt_dict = prompt.model_dump(mode="json", exclude_none=True)
    raw_messages = [
        {"role": "system", "content": "You are a concise assistant."},
        {"role": "user", "content": "Say hi to {{name}}."},
    ]

    params = {
        "prompt": prompt_dict,
        "prompt_messages": raw_messages,
    }

    committed = SharedManager.commit(
        parameters=params,
        variant_slug=test_variant["variant_slug"],
        app_id=test_variant["app_id"],
    )
    assert committed is not None

    fetched = SharedManager.fetch(variant_id=committed.variant_id)
    assert fetched is not None
    assert fetched.params is not None

    stored_prompt = fetched.params.get("prompt")
    assert isinstance(stored_prompt, dict)
    assert stored_prompt.get("template_format") == "curly"

    stored_messages = stored_prompt.get("messages")
    assert isinstance(stored_messages, list)
    assert stored_messages[0].get("role") == "system"
    assert stored_messages[1].get("role") == "user"
    assert stored_messages[1].get("content") == "Say hi to {{name}}."

    PromptTemplate(**stored_prompt)
