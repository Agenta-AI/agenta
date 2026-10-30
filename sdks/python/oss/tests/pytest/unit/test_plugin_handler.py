import inspect
import pytest
from agenta.sdk.engines.running.handlers import plugin_v0
from agenta.sdk.engines.running.templates import PLUGIN_TEMPLATES

plugin_v0 = inspect.unwrap(plugin_v0)

REVISION = {
    "data": {
        "uri": "agenta:custom:plugin:v0",
        "runtime": "javascript",
        "script": "const operations = { ping: async () => ({ok: true}) };",
        "parameters": {
            "plugin": {"operations": [{"name": "ping"}], "mcps": [], "ui": {"html": ""}}
        },
    }
}


@pytest.mark.asyncio
async def test_unknown_operation_is_refused_before_any_run():
    with pytest.raises(Exception, match="nope"):
        await plugin_v0(
            revision=REVISION,
            inputs={"operation": "nope", "args": {}},
            parameters=REVISION["data"]["parameters"],
        )


def test_template_renders_to_valid_javascript(tmp_path):
    rendered = PLUGIN_TEMPLATES["javascript"].format(
        params_json="{}", user_code="const operations = {};"
    )
    assert "const operations = {};" in rendered
    assert "X-AG-Credentials" in rendered
    # Syntax check with Node when it is installed (it is on CI images and the dev box).
    import shutil
    import subprocess

    if shutil.which("node"):
        script = tmp_path / "plugin.js"
        script.write_text(rendered)
        subprocess.run(["node", "--check", str(script)], check=True)


@pytest.mark.asyncio
async def test_null_result_is_kept(monkeypatch):
    async def fake_run(**kwargs):
        return {"value": None}

    monkeypatch.setattr("agenta.sdk.engines.running.handlers.run_code_safely", fake_run)
    assert (
        await plugin_v0(
            revision=REVISION,
            inputs={"operation": "ping", "args": {}},
            parameters=REVISION["data"]["parameters"],
        )
        is None
    )
