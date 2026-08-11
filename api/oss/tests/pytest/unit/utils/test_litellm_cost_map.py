"""Tests that litellm's cost map is sourced locally by default, not fetched
from GitHub at import time.

env.py forces LITELLM_LOCAL_MODEL_COST_MAP into os.environ at module import
time, and litellm reads that var only once, the moment it's first imported.
Both of those are import-order-sensitive, so each scenario runs in a fresh
subprocess rather than relying on importlib.reload of either module.
"""

import os
import subprocess
import sys


def _run(env_overrides: dict[str, str | None]) -> tuple[int, str, str]:
    env = dict(os.environ)
    for key, value in env_overrides.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from oss.src.utils.env import env; "
                "import litellm; "
                "print(env.litellm.local_model_cost_map); "
                "print(len(litellm.model_cost))"
            ),
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


class TestLiteLLMCostMap:
    def test_defaults_to_local_cost_map_when_unset(self):
        env_extra = dict(os.environ)
        env_extra.pop("LITELLM_LOCAL_MODEL_COST_MAP", None)
        ec, out, err = _run({"LITELLM_LOCAL_MODEL_COST_MAP": ""})
        assert ec == 0, f"stdout: {out}\nstderr: {err}"
        local_only, model_count = out.splitlines()
        assert local_only == "True"
        assert model_count == "2923"  # pinned local-backup count

    def test_explicit_false_is_respected(self):
        ec, out, err = _run({"LITELLM_LOCAL_MODEL_COST_MAP": "False"})
        assert ec == 0, f"stdout: {out}\nstderr: {err}"
        local_only, _ = out.splitlines()
        assert local_only == "False"
