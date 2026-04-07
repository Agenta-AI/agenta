"""
Unit tests for the code_v0 evaluator (agenta:builtin:code:v0).

Tests are organised into:

1. Parameter validation — invalid / missing configuration raises the right errors.
2. Return-type normalisation — the handler maps float / bool → typed result dict.
3. Context passing — inputs, outputs, and trace are forwarded to evaluate().
4. Error handling — bad code, syntax errors, and runtime failures raise CodeV0Error.
5. Threshold — custom threshold changes the success boundary.

async handlers are called via asyncio.run() so no pytest-asyncio marker is needed.
The @instrument() decorator is bypassed via __wrapped__.
"""

import asyncio

import pytest

from agenta.sdk.workflows.errors import (
    CodeV0Error,
    InvalidConfigurationParameterV0Error,
    InvalidConfigurationParametersV0Error,
    MissingConfigurationParameterV0Error,
)
from agenta.sdk.workflows.handlers import code_v0

_code_v0 = code_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def evaluate(body: str) -> str:
    """Wrap a one-liner body in a v2-compatible evaluate() function."""
    return f"def evaluate(inputs, output, trace):\n    {body}\n"


def call(
    code: str,
    *,
    inputs=None,
    outputs=None,
    trace=None,
    runtime="python",
    threshold=None,
):
    params = {"code": code, "runtime": runtime}
    if threshold is not None:
        params["threshold"] = threshold
    return run(_code_v0(parameters=params, inputs=inputs, outputs=outputs, trace=trace))


# ---------------------------------------------------------------------------
# 1. Parameter validation
# ---------------------------------------------------------------------------


class TestCodeV0Parameters:
    def test_parameters_none_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_code_v0(parameters=None))

    def test_parameters_not_dict_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_code_v0(parameters="return 1.0"))

    def test_parameters_list_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_code_v0(parameters=[{"code": "..."}]))

    def test_missing_code_key_raises(self):
        with pytest.raises(MissingConfigurationParameterV0Error):
            run(_code_v0(parameters={"runtime": "python"}))

    def test_invalid_runtime_raises(self):
        with pytest.raises(InvalidConfigurationParameterV0Error):
            run(
                _code_v0(parameters={"code": evaluate("return 1.0"), "runtime": "ruby"})
            )

    def test_unsupported_runtime_lua_raises(self):
        with pytest.raises(InvalidConfigurationParameterV0Error):
            run(_code_v0(parameters={"code": evaluate("return 1.0"), "runtime": "lua"}))


# ---------------------------------------------------------------------------
# 2. Return-type normalisation (float path via LocalRunner)
# ---------------------------------------------------------------------------


class TestCodeV0Normalisation:
    def test_returns_one(self):
        r = call(evaluate("return 1.0"))
        assert r == {"score": 1.0, "success": True}

    def test_returns_zero(self):
        r = call(evaluate("return 0.0"))
        assert r == {"score": 0.0, "success": False}

    def test_returns_integer_one(self):
        r = call(evaluate("return 1"))
        assert r["score"] == pytest.approx(1.0)
        assert r["success"] is True

    def test_returns_integer_zero(self):
        r = call(evaluate("return 0"))
        assert r["score"] == pytest.approx(0.0)
        assert r["success"] is False

    def test_boolean_true_becomes_score_one(self):
        # LocalRunner converts bool via float(); True → 1.0
        r = call(evaluate("return True"))
        assert r["score"] == pytest.approx(1.0)
        assert r["success"] is True

    def test_boolean_false_becomes_score_zero(self):
        r = call(evaluate("return False"))
        assert r["score"] == pytest.approx(0.0)
        assert r["success"] is False

    def test_mid_score_above_default_threshold(self):
        r = call(evaluate("return 0.8"))
        assert r["score"] == pytest.approx(0.8)
        assert r["success"] is True

    def test_mid_score_below_default_threshold(self):
        r = call(evaluate("return 0.3"))
        assert r["score"] == pytest.approx(0.3)
        assert r["success"] is False

    def test_score_at_default_threshold_boundary(self):
        # score == threshold → success (>=)
        r = call(evaluate("return 0.5"))
        assert r["score"] == pytest.approx(0.5)
        assert r["success"] is True


# ---------------------------------------------------------------------------
# 3. Threshold parameter
# ---------------------------------------------------------------------------


class TestCodeV0Threshold:
    def test_custom_threshold_high_makes_fail(self):
        r = call(evaluate("return 0.8"), threshold=0.9)
        assert r["score"] == pytest.approx(0.8)
        assert r["success"] is False

    def test_custom_threshold_low_makes_pass(self):
        r = call(evaluate("return 0.2"), threshold=0.1)
        assert r["score"] == pytest.approx(0.2)
        assert r["success"] is True

    def test_threshold_very_low_passes_small_score(self):
        # threshold=0.0 is treated as falsy so falls back to default 0.5;
        # use a small non-zero threshold instead
        r = call(evaluate("return 0.05"), threshold=0.04)
        assert r["success"] is True

    def test_threshold_one_only_perfect_passes(self):
        r = call(evaluate("return 1.0"), threshold=1.0)
        assert r["success"] is True

    def test_threshold_one_near_perfect_fails(self):
        r = call(evaluate("return 0.99"), threshold=1.0)
        assert r["success"] is False


# ---------------------------------------------------------------------------
# 4. Context passing: inputs, outputs, trace
# ---------------------------------------------------------------------------


class TestCodeV0Context:
    def test_inputs_forwarded(self):
        code = evaluate("return 1.0 if inputs.get('x') == 'hello' else 0.0")
        r = call(code, inputs={"x": "hello"})
        assert r["success"] is True

    def test_inputs_mismatch(self):
        code = evaluate("return 1.0 if inputs.get('x') == 'hello' else 0.0")
        r = call(code, inputs={"x": "world"})
        assert r["success"] is False

    def test_outputs_forwarded_as_string(self):
        code = evaluate("return 1.0 if output == 'yes' else 0.0")
        r = call(code, outputs="yes")
        assert r["success"] is True

    def test_outputs_forwarded_as_dict(self):
        code = evaluate(
            "return 1.0 if isinstance(output, dict) and output.get('k') == 'v' else 0.0"
        )
        r = call(code, outputs={"k": "v"})
        assert r["success"] is True

    def test_outputs_none_forwarded(self):
        code = evaluate("return 1.0 if output is None else 0.0")
        r = call(code, outputs=None)
        assert r["success"] is True

    def test_trace_forwarded(self):
        code = evaluate("return 1.0 if (trace or {}).get('latency') == 42 else 0.0")
        r = call(code, trace={"latency": 42})
        assert r["success"] is True

    def test_trace_none_forwarded(self):
        code = evaluate("return 1.0 if trace is None else 0.0")
        r = call(code, trace=None)
        assert r["success"] is True

    def test_inputs_and_outputs_together(self):
        code = evaluate("return 1.0 if inputs.get('expected') == output else 0.0")
        r = call(code, inputs={"expected": "Paris"}, outputs="Paris")
        assert r["success"] is True

    def test_inputs_and_outputs_mismatch(self):
        code = evaluate("return 1.0 if inputs.get('expected') == output else 0.0")
        r = call(code, inputs={"expected": "Paris"}, outputs="London")
        assert r["success"] is False


# ---------------------------------------------------------------------------
# 5. Error handling
# ---------------------------------------------------------------------------


class TestCodeV0Errors:
    def test_syntax_error_raises_code_error(self):
        with pytest.raises(CodeV0Error):
            call("def evaluate(inputs, output, trace)\n    return 1.0\n")

    def test_missing_evaluate_function_raises_code_error(self):
        with pytest.raises(CodeV0Error):
            call("def wrong_name(inputs, output, trace):\n    return 1.0\n")

    def test_runtime_exception_raises_code_error(self):
        with pytest.raises(CodeV0Error):
            call(evaluate("raise ValueError('deliberate')"))

    def test_division_by_zero_raises_code_error(self):
        with pytest.raises(CodeV0Error):
            call(evaluate("return 1 / 0"))

    def test_empty_code_raises_code_error(self):
        with pytest.raises(CodeV0Error):
            call("")


# ---------------------------------------------------------------------------
# 6. Runtime parameter (Python only for LocalRunner)
# ---------------------------------------------------------------------------


class TestCodeV0Runtime:
    def test_python_runtime_explicit(self):
        r = call(evaluate("return 1.0"), runtime="python")
        assert r["success"] is True

    def test_javascript_runtime_invalid_for_local_raises(self):
        # LocalRunner only supports Python; JS/TS raises CodeV0Error
        with pytest.raises(CodeV0Error):
            call(
                "function evaluate(inputs, output, trace) { return 1.0; }",
                runtime="javascript",
            )

    def test_typescript_runtime_invalid_for_local_raises(self):
        with pytest.raises(CodeV0Error):
            call(
                "function evaluate(inputs: any, output: any, trace: any): number { return 1.0; }",
                runtime="typescript",
            )
