"""Built-in LLM tools must not access the service filesystem."""

import pytest

from agenta.sdk.engines.running import handlers
from agenta.sdk.engines.running.errors import InvalidConfigurationParameterV0Error

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("name", ["files.read", "files.list", "files.search"])
@pytest.mark.parametrize("loop", [None, {"max_iterations": 1}])
async def test_file_tools_are_rejected_before_model_call(
    monkeypatch, tmp_path, name, loop
):
    async def unexpected_model_call(**kwargs):
        pytest.fail("Invalid internal tools must be rejected before a model call")

    monkeypatch.setattr(handlers, "_call_llm_with_fallback", unexpected_model_call)
    with pytest.raises(InvalidConfigurationParameterV0Error) as exc:
        await handlers.llm_v0.__wrapped__(
            parameters={
                "llms": [{"model": "gpt-4o-mini"}],
                "tools": {"internal": [name]},
                "files": {"roots": [str(tmp_path)]},
                "loop": loop,
            },
        )
    assert exc.value.code == 400
    assert "tools.internal" in exc.value.message


@pytest.mark.parametrize("name", ["files.read", "files.list", "files.search"])
async def test_internal_dispatch_cannot_read_files(tmp_path, name):
    fixture = tmp_path / "fixture.txt"
    fixture.write_text("harmless test fixture")
    result = await handlers._execute_internal_tool(
        name=name,
        arguments={"path": str(fixture), "query": "harmless"},
        context={},
    )
    assert result == {"error": f"Unknown internal tool: {name}"}
    assert handlers._build_llm_tools({"internal": [name]}) is None


async def test_control_tool_still_terminates_loop(monkeypatch):
    async def terminate(**kwargs):
        assert kwargs["tools"][0]["function"]["name"] == "control.terminate"
        return {
            "role": "assistant",
            "tool_calls": [{"id": "done", "function": {"name": "control.terminate"}}],
        }, {}

    monkeypatch.setattr(handlers, "_call_llm_with_fallback", terminate)
    result = await handlers.llm_v0.__wrapped__(
        parameters={
            "llms": [{"model": "gpt-4o-mini"}],
            "tools": {"internal": ["control.terminate"]},
            "loop": {"max_iterations": 1},
        }
    )
    assert result["status"]["message"] == "completed"
