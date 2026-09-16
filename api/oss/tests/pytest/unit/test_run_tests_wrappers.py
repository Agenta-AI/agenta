"""The three `run-tests.py` wrappers assemble the pytest command they promise.

Nothing tested them. They are what every other green result in this repository is produced
by, so a wrapper that quietly runs something other than what was asked makes every one of
those results a claim about an unknown selection (P7, P11, P12).

All three carry the same code, so all three are driven here, and a fix applied to one of
them is visibly missing from the others rather than silently absent.
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest
from click.testing import CliRunner


_REPO = Path(__file__).resolve().parents[5]
_WRAPPERS = {
    "api": _REPO / "api" / "run-tests.py",
    "sdk": _REPO / "sdks" / "python" / "run-tests.py",
    "services": _REPO / "services" / "run-tests.py",
}


def _load(name: str):
    path = _WRAPPERS[name]
    assert path.exists(), f"no wrapper at {path}"
    spec = importlib.util.spec_from_file_location(f"_run_tests_{name}", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=sorted(_WRAPPERS))
def wrapper(request, monkeypatch):
    """One wrapper, loaded, with its subprocess call captured and its package as cwd.

    The command is read off the call rather than rebuilt here, so this asserts what pytest
    would actually receive.
    """
    name = request.param
    module = _load(name)
    recorded: list = []

    def _capture(cmd, *args, **kwargs):
        recorded.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(module.subprocess, "run", _capture)
    monkeypatch.setenv("AGENTA_LICENSE", "oss")
    monkeypatch.chdir(_WRAPPERS[name].parent)

    def _run(*argv) -> list:
        result = CliRunner().invoke(module.run_tests, list(argv))
        assert result.exit_code == 0, result.output
        assert recorded, f"{name} never ran pytest: {result.output}"
        return recorded[-1]

    _run.name = name  # type: ignore[attr-defined]
    _run.module = module  # type: ignore[attr-defined]
    return _run


def _marker_expressions(cmd: list) -> list:
    return [cmd[i + 1] for i, arg in enumerate(cmd) if arg == "-m"]


# ---------------------------------------------------------------------------
# P7/P11/P12: the caller's own marker expression
# ---------------------------------------------------------------------------


def test_a_forwarded_marker_expression_is_not_overruled(wrapper):
    """pytest honours the LAST `-m` it is given and the wrapper appended its own after the
    forwarded ones, so a caller asking for one selection was given another and told it
    passed. `hosting/docker-compose/test.sh` always injects `--fast`, so it took that
    path every time."""
    cmd = wrapper("--layer", "unit", "--fast", "--", "-m", "acceptance")

    assert len(_marker_expressions(cmd)) == 1, cmd
    expression = _marker_expressions(cmd)[0]
    assert "acceptance" in expression
    assert "not slow" in expression


def test_a_forwarded_marker_expression_survives_a_dimension_flag_too(wrapper):
    cmd = wrapper("--layer", "unit", "--speed", "fast", "--", "-m", "acceptance")

    expression = _marker_expressions(cmd)[0]
    assert "acceptance" in expression
    assert "speed_fast" in expression


def test_a_forwarded_marker_expression_alone_still_reaches_pytest(wrapper):
    cmd = wrapper("--layer", "unit", "--", "-m", "acceptance")

    assert _marker_expressions(cmd) == ["(acceptance)"], cmd


@pytest.mark.parametrize("spelling", ["-m=acceptance", "-macceptance"])
def test_the_attached_spellings_are_read_too(wrapper, spelling):
    """`-m acceptance`, `-m=acceptance` and `-macceptance` are one option to pytest, so a
    wrapper that recognises only the spaced form drops the other two."""
    cmd = wrapper("--layer", "unit", "--fast", "--", spelling)

    assert len(_marker_expressions(cmd)) == 1, cmd
    assert "acceptance" in _marker_expressions(cmd)[0]
