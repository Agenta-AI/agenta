"""Level 1 (specs.md "Testing contract"): `llm_v0` / `chat_v0` / `completion_v0` called
DIRECTLY (no HTTP, no `@workflow`), the flag cube for the running-layer handler contract.

`llm_v0`: force=true -> 406-mapped error; `stream` is ignored (same batch envelope either
way); `trim=true` -> trailing unit of its `messages` envelope, else full.
`chat_v0`/`completion_v0` are flag-blind: identical output across every flag combo (no code
reads `request.flags` there at all — there is no `request` param).
"""

from __future__ import annotations

from contextlib import nullcontext
from itertools import product
from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running import handlers
from agenta.sdk.engines.running.errors import ForceNotSupportedV0Error
from agenta.sdk.models.workflows import WorkflowServiceRequest

pytestmark = pytest.mark.asyncio

_UNSET = object()
_FLAG_VALUES = (_UNSET, False, True)


def _flags_request(*, stream, trim, force):
    """`_UNSET` keys are omitted from `flags` entirely (absent, not explicit null)."""
    flags = {}
    if stream is not _UNSET:
        flags["stream"] = stream
    if trim is not _UNSET:
        flags["trim"] = trim
    if force is not _UNSET:
        flags["force"] = force
    return WorkflowServiceRequest(flags=flags or None)


class _FakeMessage:
    content = "hi there"

    def model_dump(self, exclude_none=True):
        return {"role": "assistant", "content": "hi there"}


@pytest.fixture
def fake_llm(monkeypatch):
    """Mock every LLM entry point the handlers under test call, so all of `llm_v0`
    (via `_load_litellm`/`litellm.acompletion`), `chat_v0`, and `completion_v0` (both via
    `mockllm.acompletion`) run with no network/LLM/vault."""

    async def acompletion(**kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=_FakeMessage())],
            usage={"total_tokens": 3},
        )

    fake_litellm = SimpleNamespace(acompletion=acompletion)

    async def retrieve_secrets():
        return [], [], []

    async def ensure_secrets():
        return None

    monkeypatch.setattr(handlers, "_load_litellm", lambda: fake_litellm)
    monkeypatch.setattr(handlers.SecretsManager, "retrieve_secrets", retrieve_secrets)
    monkeypatch.setattr(
        handlers.SecretsManager, "ensure_secrets_in_workflow", ensure_secrets
    )
    monkeypatch.setattr(
        handlers.SecretsManager,
        "get_provider_settings_from_workflow",
        lambda model: {"model": model, "api_key": "test-key"},
    )
    monkeypatch.setattr(handlers.mockllm, "acompletion", acompletion)
    monkeypatch.setattr(
        handlers.mockllm,
        "user_aws_credentials_from",
        lambda _settings: nullcontext(),
    )
    return fake_litellm


_LLM_PARAMETERS = {"llms": [{"model": "gpt-4o-mini"}]}
# "full" 2-message envelope; trim=true keeps just the trailing message.
_FULL_MESSAGES = [
    {"role": "user", "content": "hi"},
    {"role": "assistant", "content": "hi there"},
]
_TRIMMED_MESSAGES = [_FULL_MESSAGES[-1]]


async def _invoke_llm_v0(request):
    return await handlers.llm_v0.__wrapped__(
        request=request,
        inputs={"messages": [{"role": "user", "content": "hi"}]},
        parameters=_LLM_PARAMETERS,
    )


@pytest.mark.parametrize(
    "stream,trim,force", list(product(_FLAG_VALUES, _FLAG_VALUES, _FLAG_VALUES))
)
async def test_llm_v0_flag_cube(fake_llm, stream, trim, force):
    request = _flags_request(stream=stream, trim=trim, force=force)

    # force=true -> 406-mapped error regardless of stream/trim.
    if force is True:
        with pytest.raises(ForceNotSupportedV0Error):
            await _invoke_llm_v0(request)
        return

    result = await _invoke_llm_v0(request)

    # llm_v0 ignores `stream`; the batch envelope is identical unset/false/true.
    assert isinstance(result, dict)
    assert result["status"] == {"code": 200, "type": "success", "message": "completed"}

    if trim is True:
        assert result["messages"] == _TRIMMED_MESSAGES
    else:
        # trim absent or explicit False both mean "full".
        assert result["messages"] == _FULL_MESSAGES


async def test_llm_v0_stream_true_alone_does_not_change_shape(fake_llm):
    """Isolates the `stream` axis: true vs false vs unset all produce the same dict shape
    (no generator, ever) -- pinning `llm_v0 ignores stream` from specs.md independent of
    the full cube's parametrization."""
    bodies = [
        await _invoke_llm_v0(_flags_request(stream=s, trim=_UNSET, force=_UNSET))
        for s in (_UNSET, False, True)
    ]
    assert bodies[0] == bodies[1] == bodies[2]
    assert all(isinstance(body, dict) for body in bodies)


# chat_v0 / completion_v0: flag-blind by construction (no `request` param at all).


_CHAT_PARAMETERS = {
    "prompt": {
        "messages": [{"role": "system", "content": "Be concise."}],
        "llm_config": {"model": "gpt-4o-mini"},
    }
}
_COMPLETION_PARAMETERS = {
    "prompt": {
        "messages": [{"role": "system", "content": "Say hi to {{name}}."}],
        "llm_config": {"model": "gpt-4o-mini"},
    }
}

# Representative subset of the flag cube; chat_v0/completion_v0 take no `request` param.
_REPRESENTATIVE_FLAG_COMBOS = [
    None,
    {},
    {"stream": False, "trim": False, "force": False},
    {"stream": True, "trim": True, "force": True},
    {"stream": True},
    {"trim": True},
    {"force": True},
]


@pytest.mark.parametrize("flags", _REPRESENTATIVE_FLAG_COMBOS)
async def test_chat_v0_output_identical_across_flag_combos(fake_llm, flags):
    # `flags` is accepted only to prove the sweep covers the cube; never threaded through.
    del flags
    result = await handlers.chat_v0.__wrapped__(
        parameters=_CHAT_PARAMETERS,
        inputs={},
        messages=[{"role": "user", "content": "hello"}],
    )
    assert result == {"role": "assistant", "content": "hi there"}


@pytest.mark.parametrize("flags", _REPRESENTATIVE_FLAG_COMBOS)
async def test_completion_v0_output_identical_across_flag_combos(fake_llm, flags):
    del flags
    result = await handlers.completion_v0.__wrapped__(
        parameters=_COMPLETION_PARAMETERS,
        inputs={"name": "world"},
    )
    assert result == "hi there"
