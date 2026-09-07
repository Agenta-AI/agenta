"""F4: a commit must not be able to store an agent config the runtime cannot run.

The gate's H1 cell committed `harness.kind` as `12345` and as `"not_a_real_harness"`. Both were
accepted with a 200. The config was then unrunnable forever, and the invoke that proved it died
on an unhandled 500 whose body was a Python repr, far from the request that caused it.

The check is deliberately narrow: one field, read only when the commit actually carries it. The
cases below pin both halves of that — the values it refuses, and the far larger set of commits it
must leave completely alone, including every config that never names a harness.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from starlette.responses import JSONResponse

from oss.src.core.workflows.dtos import WorkflowRevisionCommit
from oss.src.core.workflows.service import (
    WorkflowsService,
    _reject_unreadable_harness_kind,
)
from oss.src.core.workflows.types import InvalidAgentHarnessError


def _data(kind):
    return {"parameters": {"agent": {"harness": {"kind": kind}}}}


class TestValuesItRefuses:
    @pytest.mark.parametrize("kind", [12345, "not_a_real_harness", 0, "pi", "claude "])
    def test_a_kind_the_runtime_cannot_read_is_refused(self, kind):
        with pytest.raises(InvalidAgentHarnessError) as caught:
            _reject_unreadable_harness_kind(_data(kind))

        assert caught.value.code == "invalid_harness_kind"

    def test_the_envelope_names_the_field_the_value_and_what_is_allowed(self):
        with pytest.raises(InvalidAgentHarnessError) as caught:
            _reject_unreadable_harness_kind(_data("not_a_real_harness"))

        detail = caught.value.to_detail()
        assert detail["code"] == "invalid_harness_kind"
        assert detail["retryable"] is False
        assert detail["next_step"]
        assert detail["details"]["field"] == "parameters.agent.harness.kind"
        assert detail["details"]["value"] == "not_a_real_harness"
        assert set(detail["details"]["allowed"]) == {"pi_core", "claude", "codex"}


class TestTheEchoedValueSurvivesTheResponse:
    """The refusal must not become the 500 it exists to replace.

    Python's json parser accepts the non-standard `NaN` and `Infinity` literals in a request
    body, so a caller really can send one as a harness kind. Starlette serializes a response
    with `allow_nan=False`, so echoing that float verbatim raised inside the response itself.
    """

    @pytest.mark.parametrize(
        "kind,echoed",
        [
            (float("nan"), "nan"),
            (float("inf"), "inf"),
            (float("-inf"), "-inf"),
        ],
    )
    def test_a_non_finite_float_is_echoed_as_text(self, kind, echoed):
        with pytest.raises(InvalidAgentHarnessError) as caught:
            _reject_unreadable_harness_kind(_data(kind))

        detail = caught.value.to_detail()
        assert detail["details"]["value"] == echoed
        # The whole envelope has to survive the response, not just this field.
        JSONResponse(detail)

    @pytest.mark.parametrize("kind", [12345, "not_a_real_harness", 0])
    def test_an_ordinary_value_is_still_echoed_as_itself(self, kind):
        with pytest.raises(InvalidAgentHarnessError) as caught:
            _reject_unreadable_harness_kind(_data(kind))

        detail = caught.value.to_detail()
        assert detail["details"]["value"] == kind
        JSONResponse(detail)


class TestCommitsItMustNotTouch:
    @pytest.mark.parametrize("kind", ["pi_core", "claude", "codex", "PI_CORE"])
    def test_a_readable_kind_passes(self, kind):
        _reject_unreadable_harness_kind(_data(kind))

    def test_a_legacy_pi_agenta_config_still_commits(self):
        # The experiment is gone, but revisions saved while it existed still carry the value
        # and must stay editable. The runtime maps it to plain Pi on read.
        _reject_unreadable_harness_kind(_data("pi_agenta"))

    @pytest.mark.parametrize("kind", [None, "", "   "])
    def test_an_absent_kind_means_the_default_and_is_not_a_refusal(self, kind):
        _reject_unreadable_harness_kind(_data(kind))

    @pytest.mark.parametrize(
        "data",
        [
            None,
            {},
            {"parameters": None},
            {"parameters": {}},
            {"parameters": {"agent": None}},
            {"parameters": {"agent": {"instructions": "hi"}}},
            {"parameters": {"agent": {"harness": None}}},
            {"parameters": {"agent": {"harness": {}}}},
            # A workflow that is not an agent at all: the prompt/chat shape.
            {"parameters": {"prompt": {"llm_config": {"model": "gpt-5.5"}}}},
        ],
    )
    def test_a_commit_that_does_not_carry_the_field_is_untouched(self, data):
        _reject_unreadable_harness_kind(data)


class TestNothingIsPersisted:
    """The point of the boundary: the refusal happens BEFORE the write, not after it."""

    @pytest.mark.asyncio
    async def test_the_checked_commit_refuses_before_it_reaches_the_dao(self):
        workflows_dao = AsyncMock()
        # No head yet, so the base check has nothing to compare and the commit walks straight
        # to the write it must not reach.
        workflows_dao.fetch_revision.return_value = None
        service = WorkflowsService(workflows_dao=workflows_dao)

        with pytest.raises(InvalidAgentHarnessError):
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=WorkflowRevisionCommit(
                    slug="qa-h1-harness",
                    workflow_variant_id=uuid4(),
                    data={
                        "uri": "agenta:builtin:agent:v0",
                        "parameters": {"agent": {"harness": {"kind": 12345}}},
                    },
                ),
            )

        workflows_dao.commit_revision.assert_not_awaited()
