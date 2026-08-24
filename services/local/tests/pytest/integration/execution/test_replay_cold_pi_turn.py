"""Replayed cold Pi turn: the real SDK adapter against a fixture-serving replay runner."""

import json
from pathlib import Path

import pytest
from agenta_local.core.agents.dtos import AgentModel, AgentRevision
from agenta_local.core.execution.dtos import ExecutionCredential, ExecutionMessage
from agenta_local.execution.sdk.adapter import SDKAgentExecutor

from ...utils.replay_runner import ReplayRunner

pytestmark = pytest.mark.integration

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "runner"
REQUEST_FIXTURE = FIXTURES_DIR / "cold_pi_turn.request.json"
STREAM_FIXTURE = FIXTURES_DIR / "cold_pi_turn.ndjson"
RESULT_FIXTURE = FIXTURES_DIR / "cold_pi_turn.result.json"

# Must match the documented capture inputs (tests/fixtures/runner/README.md).
INSTRUCTIONS = "You are a terse assistant. Reply with exactly one short sentence."
PROMPT = "Say hello in exactly five words."

_missing_fixtures = [
    path.name
    for path in (REQUEST_FIXTURE, STREAM_FIXTURE, RESULT_FIXTURE)
    if not path.exists()
]
requires_fixtures = pytest.mark.skipif(
    bool(_missing_fixtures),
    reason=f"replay fixtures not captured yet: {_missing_fixtures}",
)


def _revision() -> AgentRevision:
    return AgentRevision(
        id="replay",
        version=1,
        instructions=INSTRUCTIONS,
        model=AgentModel(provider="openai", name="gpt-4o-mini"),
    )


@requires_fixtures
async def test_replay_cold_pi_turn_matches_recorded_request_and_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_fixture = json.loads(REQUEST_FIXTURE.read_text(encoding="utf-8"))
    expected_text = json.loads(RESULT_FIXTURE.read_text(encoding="utf-8"))[
        "assistant_text"
    ]

    with ReplayRunner(
        request_fixture=request_fixture, ndjson_path=STREAM_FIXTURE
    ) as runner:
        monkeypatch.setenv("AGENTA_RUNNER_TOKEN", runner.token)

        executor = SDKAgentExecutor(runner_url=runner.url)
        stream = executor.stream(
            revision=_revision(),
            messages=[ExecutionMessage(role="user", content=PROMPT)],
            credential=ExecutionCredential(provider="openai", api_key="sk-redacted"),
        )
        frames = [frame.payload async for frame in stream.events]

        assert frames[0]["type"] == "start"
        assert frames[-2]["type"] == "finish-step"
        assert frames[-1]["type"] == "finish"
        result = await stream.result()
        assert result.assistant_text == expected_text

        assert runner.request_matches is True, (
            f"outbound /run request drifted from the fixture: {runner.last_request}"
        )
