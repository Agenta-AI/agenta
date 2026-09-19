import sys
from types import ModuleType
import pytest

# Ensure litellm module is mocked for unit test environment
if "litellm" not in sys.modules:
    litellm_mod = ModuleType("litellm")
    litellm_int = ModuleType("litellm.integrations")
    litellm_logger = ModuleType("litellm.integrations.custom_logger")

    class CustomLogger:
        def __init__(self):
            pass

    litellm_logger.CustomLogger = CustomLogger
    sys.modules["litellm"] = litellm_mod
    sys.modules["litellm.integrations"] = litellm_int
    sys.modules["litellm.integrations.custom_logger"] = litellm_logger

import agenta as ag
from agenta.sdk.litellm.litellm import litellm_handler


@pytest.fixture(autouse=True)
def init_agenta():
    ag.init(api_key="test-api-key")


def test_log_pre_api_call_with_optional_params_none():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "call-opt-none",
        "call_type": "completion",
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "hello"}],
        "optional_params": None,
    }
    # Should not raise TypeError: 'NoneType' object is not a mapping
    handler.log_pre_api_call(
        model="gpt-4o",
        messages=[{"role": "user", "content": "hello"}],
        kwargs=kwargs,
    )
    assert "call-opt-none" in handler.span


def test_log_pre_api_call_without_optional_params():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "call-no-opt",
        "call_type": "completion",
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "hello"}],
    }
    handler.log_pre_api_call(
        model="gpt-4o",
        messages=[{"role": "user", "content": "hello"}],
        kwargs=kwargs,
    )
    assert "call-no-opt" in handler.span


def test_log_pre_api_call_embedding_without_messages():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "call-embed",
        "call_type": "embedding",
        "model": "text-embedding-3-small",
        "input": ["some text to embed"],
    }
    # Should not raise KeyError: 'messages'
    handler.log_pre_api_call(
        model="text-embedding-3-small",
        messages=None,
        kwargs=kwargs,
    )
    assert "call-embed" in handler.span


def test_log_pre_api_call_with_positional_messages_only():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "call-pos-msg",
        "call_type": "completion",
        "model": "gpt-4o",
    }
    messages = [{"role": "user", "content": "hello world"}]
    # Should not raise KeyError: 'messages'
    handler.log_pre_api_call(
        model="gpt-4o",
        messages=messages,
        kwargs=kwargs,
    )
    assert "call-pos-msg" in handler.span


def test_log_success_event_unknown_call_id():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "non-existent-call-id",
    }
    # Should gracefully return and not raise KeyError
    handler.log_success_event(
        kwargs=kwargs,
        response_obj=None,
        start_time=0,
        end_time=0,
    )


def test_log_failure_event_unknown_call_id():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "non-existent-call-id",
        "exception": RuntimeError("boom"),
    }
    # Should gracefully return and not raise KeyError
    handler.log_failure_event(
        kwargs=kwargs,
        response_obj=None,
        start_time=0,
        end_time=0,
    )


def test_log_failure_event_missing_exception_key():
    handler = litellm_handler()
    # First create span
    call_id = "call-fail-no-exc"
    kwargs = {
        "litellm_call_id": call_id,
        "call_type": "completion",
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "test"}],
        "optional_params": {},
    }
    handler.log_pre_api_call(model="gpt-4o", messages=None, kwargs=kwargs)
    assert call_id in handler.span

    # Failure without 'exception' key in kwargs
    handler.log_failure_event(
        kwargs={"litellm_call_id": call_id},
        response_obj=None,
        start_time=0,
        end_time=0,
    )
    assert call_id not in handler.span


@pytest.mark.asyncio
async def test_async_log_success_event_unknown_call_id():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "non-existent-async-call-id",
    }
    await handler.async_log_success_event(
        kwargs=kwargs,
        response_obj=None,
        start_time=0,
        end_time=0,
    )


@pytest.mark.asyncio
async def test_async_log_failure_event_unknown_call_id():
    handler = litellm_handler()
    kwargs = {
        "litellm_call_id": "non-existent-async-call-id",
        "exception": RuntimeError("boom"),
    }
    await handler.async_log_failure_event(
        kwargs=kwargs,
        response_obj=None,
        start_time=0,
        end_time=0,
    )


@pytest.mark.asyncio
async def test_async_log_failure_event_missing_exception_key():
    handler = litellm_handler()
    call_id = "call-async-fail-no-exc"
    kwargs = {
        "litellm_call_id": call_id,
        "call_type": "completion",
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "test"}],
        "optional_params": {},
    }
    handler.log_pre_api_call(model="gpt-4o", messages=None, kwargs=kwargs)
    assert call_id in handler.span

    await handler.async_log_failure_event(
        kwargs={"litellm_call_id": call_id},
        response_obj=None,
        start_time=0,
        end_time=0,
    )
    assert call_id not in handler.span
