"""
Unit tests for the RestrictedRunner (default custom-code evaluator sandbox) and
the runner registry.

The RestrictedRunner executes evaluator code in-process via RestrictedPython.
These tests assert two things:

1. Functionality — normal evaluators run and the v1/v2 interfaces both work,
   allowlisted pure-stdlib imports (e.g. math) are available.
2. Security — host-reaching imports and the classic attribute-gadget escape are
   blocked (they raise instead of executing), which is the whole point of making
   this the default.

The runner re-raises any failure as one of SyntaxError / ImportError / KeyError /
RuntimeError, so "blocked" is asserted against that union rather than a single
type (RestrictedPython rejects some escapes at compile time and others at run
time, and we want the test to hold regardless of which path fires).
"""

import pytest

from agenta.sdk.engines.running.runners.local import LocalRunner
from agenta.sdk.engines.running.runners.registry import get_runner
from agenta.sdk.engines.running.runners.restricted import RestrictedRunner


# Errors that all count as "the sandbox blocked this".
BLOCKED = (SyntaxError, ImportError, RuntimeError, NameError, AttributeError, KeyError)


def v1(body: str) -> str:
    """Wrap a one-liner body in a legacy v1 evaluate() function."""
    return f"def evaluate(app_params, inputs, output, correct_answer):\n    {body}\n"


def v2(body: str) -> str:
    """Wrap a one-liner body in a v2 evaluate() function."""
    return f"def evaluate(inputs, output, trace):\n    {body}\n"


def run_v2(runner, code, *, inputs=None, output="", trace=None):
    return runner.run(
        code, {}, inputs or {}, output, None, "python", None, version="2", trace=trace
    )


def run_v1(runner, code, *, inputs=None, output="", correct_answer=None):
    return runner.run(
        code, {}, inputs or {}, output, correct_answer, "python", None, version="1"
    )


# ---------------------------------------------------------------------------
# 1. Functionality
# ---------------------------------------------------------------------------


class TestRestrictedRunnerFunctionality:
    def setup_method(self):
        self.runner = RestrictedRunner()

    def test_v2_returns_float(self):
        assert run_v2(self.runner, v2("return 0.5")) == 0.5

    def test_v1_returns_float(self):
        assert run_v1(self.runner, v1("return 1.0")) == 1.0

    def test_int_coerced_to_float(self):
        assert run_v2(self.runner, v2("return 1")) == 1.0

    def test_bool_coerced_to_float(self):
        assert run_v2(self.runner, v2("return True")) == 1.0

    def test_inputs_accessible(self):
        code = v2("return 1.0 if inputs.get('x') == 'hi' else 0.0")
        assert run_v2(self.runner, code, inputs={"x": "hi"}) == 1.0

    def test_output_and_builtins_accessible(self):
        code = v2("return float(len(output)) / 10.0")
        assert run_v2(self.runner, code, output="abcde") == 0.5

    def test_trace_accessible(self):
        code = v2("return 1.0 if (trace or {}).get('latency') == 42 else 0.0")
        assert run_v2(self.runner, code, trace={"latency": 42}) == 1.0

    def test_allowed_import_math(self):
        code = (
            "import math\n"
            "def evaluate(inputs, output, trace):\n"
            "    return math.sqrt(0.25)\n"
        )
        assert run_v2(self.runner, code) == 0.5

    def test_allowed_import_json(self):
        code = (
            "import json\n"
            "def evaluate(inputs, output, trace):\n"
            "    return float(json.loads('1'))\n"
        )
        assert run_v2(self.runner, code) == 1.0

    def test_non_python_runtime_rejected(self):
        with pytest.raises(ValueError):
            self.runner.run(
                v2("return 1.0"),
                {},
                {},
                "",
                None,
                "javascript",
                None,
                version="2",
                trace={},
            )

    def test_missing_evaluate_raises(self):
        code = "def not_evaluate(inputs, output, trace):\n    return 1.0\n"
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)


# ---------------------------------------------------------------------------
# 2. Security — escapes must be blocked
# ---------------------------------------------------------------------------


class TestRestrictedRunnerSecurity:
    def setup_method(self):
        self.runner = RestrictedRunner()

    def test_blocks_import_os(self):
        code = (
            "import os\n"
            "def evaluate(inputs, output, trace):\n"
            "    os.system('echo pwned')\n"
            "    return 1.0\n"
        )
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_import_subprocess(self):
        code = (
            "import subprocess\ndef evaluate(inputs, output, trace):\n    return 1.0\n"
        )
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_import_httpx_no_network(self):
        # httpx is deliberately excluded: no outbound network from the sandbox.
        code = "import httpx\ndef evaluate(inputs, output, trace):\n    return 1.0\n"
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_dunder_import_call(self):
        code = v2("return __import__('os').system('echo pwned')")
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_open_builtin(self):
        code = v2("return float(open('/etc/passwd').read()[:0] == '')")
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_class_gadget_escape(self):
        # The classic RestrictedPython escape: reach a host module via the object
        # graph. Blocked because dunder attribute access is denied.
        code = v2("return float(len(().__class__.__bases__[0].__subclasses__()) > 0)")
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)

    def test_blocks_eval_builtin(self):
        code = v2("return float(eval('1+1'))")
        with pytest.raises(BLOCKED):
            run_v2(self.runner, code)


# ---------------------------------------------------------------------------
# 3. Registry selection
# ---------------------------------------------------------------------------


class TestGetRunner:
    def _clear(self, monkeypatch):
        monkeypatch.delenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", raising=False)
        monkeypatch.delenv("AGENTA_SERVICES_SANDBOX_RUNNER", raising=False)

    def test_default_is_local(self, monkeypatch):
        self._clear(monkeypatch)
        assert isinstance(get_runner(), LocalRunner)

    def test_explicit_restricted(self, monkeypatch):
        self._clear(monkeypatch)
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", "restricted")
        assert isinstance(get_runner(), RestrictedRunner)

    def test_local_opt_in(self, monkeypatch):
        self._clear(monkeypatch)
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", "local")
        assert isinstance(get_runner(), LocalRunner)

    def test_legacy_var_still_works(self, monkeypatch):
        self._clear(monkeypatch)
        monkeypatch.setenv("AGENTA_SERVICES_SANDBOX_RUNNER", "local")
        assert isinstance(get_runner(), LocalRunner)

    def test_canonical_overrides_legacy(self, monkeypatch):
        self._clear(monkeypatch)
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", "restricted")
        monkeypatch.setenv("AGENTA_SERVICES_SANDBOX_RUNNER", "local")
        assert isinstance(get_runner(), RestrictedRunner)

    def test_unknown_value_raises(self, monkeypatch):
        self._clear(monkeypatch)
        monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", "nope")
        with pytest.raises(ValueError):
            get_runner()
