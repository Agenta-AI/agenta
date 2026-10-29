"""Every committed Python suite needs a job that runs it.

`clients/python/tests` held four suites that nothing executed: no `run-tests.py`, no job in
the unit-test workflow, and no path filter that would have started one. They passed locally
and were never run anywhere else, so a change that broke the generated client was caught by
nobody (D81).

Checked from the API suite rather than from the client's own, because a guard that only runs
inside the job it is guarding disappears with it.
"""

from pathlib import Path

import pytest

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML is a transitive dependency here
    yaml = None


_REPO = Path(__file__).resolve().parents[5]
_WORKFLOW = _REPO / ".github" / "workflows" / "12-check-unit-tests.yml"
_CLIENT_TESTS = _REPO / "clients" / "python" / "tests"


@pytest.fixture(scope="module")
def workflow() -> dict:
    if yaml is None:
        pytest.skip("PyYAML is not installed")
    return yaml.safe_load(_WORKFLOW.read_text())


def _steps(workflow: dict) -> list:
    return [
        step
        for job in workflow["jobs"].values()
        for step in job.get("steps", [])
        if isinstance(step, dict)
    ]


def test_the_client_suite_is_not_empty():
    """The rest of this file asserts something runs these. If they are gone, say so here
    rather than reporting that a job runs nothing."""
    assert list(_CLIENT_TESTS.glob("test_*.py")), f"no suites under {_CLIENT_TESTS}"


def test_a_job_runs_the_client_suite(workflow):
    running = [
        step
        for step in _steps(workflow)
        if step.get("working-directory") == "clients/python"
        and "pytest" in str(step.get("run", ""))
    ]

    assert running, "no job in the unit-test workflow runs clients/python's tests"


def test_a_change_to_the_client_starts_that_job(workflow):
    """A job nothing triggers is a job that does not run. The workflow is filtered by path,
    so the package has to be one of them."""
    # `on` is the YAML boolean True once parsed, which is why it is read this way.
    triggers = workflow.get("on") or workflow.get(True)
    paths = triggers["pull_request"]["paths"]

    assert any(path.startswith("clients/python") for path in paths), paths
