"""The routes call the real service, with the real signatures.

This file exists because of a specific failure. The core read's `run_is_draft` parameter
moved into the tool handler, the legacy route kept passing it, and the API suite stayed
green at 2133 while EVERY live read-config call returned 500. Every route test mocked the
service, so nothing in CI ever put a route and the real service class in the same room.

So these cells assert agreement rather than behavior: what a route passes must be what the
service accepts. They are cheap, they need no database, and they fail on the kind of drift
that unit tests are structurally blind to.

The routes stay load-bearing until the migration deletes them, and the dev stack runs the
working tree continuously, so a signature drift here is a live outage, not a future one.
"""

import inspect

import pytest

from oss.src.apis.fastapi.workflows.router import WorkflowsRouter
from oss.src.core.workflows.service import WorkflowsService


def _accepted(method) -> set:
    return {
        name
        for name, parameter in inspect.signature(method).parameters.items()
        if name != "self"
        and parameter.kind not in (parameter.VAR_KEYWORD, parameter.VAR_POSITIONAL)
    }


def _kwargs_passed(source: str, call: str) -> set:
    """The keyword names a call site hands over, read from the source."""
    body = source.split(f"{call}(", 1)[1]
    depth, out, current = 1, set(), ""
    for char in body:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
            if depth == 0:
                break
        if depth == 1 and char == "=" and current.strip().isidentifier():
            out.add(current.strip())
            current = ""
        elif depth == 1 and char == ",":
            current = ""
        else:
            current += char
    return out


@pytest.mark.parametrize(
    "route_method,service_method,call_name",
    [
        (
            WorkflowsRouter.read_workflow_revision_config,
            WorkflowsService.read_workflow_revision_config,
            "self.workflows_service.read_workflow_revision_config",
        ),
        (
            WorkflowsRouter._commit_workflow_revision,
            WorkflowsService.commit_workflow_revision_checked,
            "self.workflows_service.commit_workflow_revision_checked",
        ),
    ],
    ids=["read-config", "commit"],
)
def test_a_route_passes_only_what_the_service_accepts(
    route_method, service_method, call_name
):
    source = inspect.getsource(inspect.getmodule(WorkflowsRouter))
    passed = _kwargs_passed(source, call_name)
    accepted = _accepted(service_method)

    assert passed, f"could not read the call site for {call_name}"
    unknown = passed - accepted
    assert not unknown, (
        f"{call_name} passes {sorted(unknown)}, which the service does not accept. "
        "This is a 500 on every live call, and mocked route tests cannot see it."
    )


def test_the_read_route_no_longer_passes_the_draft_fact():
    # The specific regression, pinned by name. `run_is_draft` describes the RUN, so the
    # core read does not take it: the caller decorates its own answer.
    source = inspect.getsource(inspect.getmodule(WorkflowsRouter))
    passed = _kwargs_passed(
        source, "self.workflows_service.read_workflow_revision_config"
    )

    assert "run_is_draft" not in passed
    assert "run_is_draft" not in _accepted(
        WorkflowsService.read_workflow_revision_config
    )
