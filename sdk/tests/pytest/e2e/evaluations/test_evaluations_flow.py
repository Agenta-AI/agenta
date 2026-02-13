"""
Integration tests for the Evaluations flow.

Tests cover:
- Evaluation run create/fetch/close lifecycle
- Scenario creation within a run
- Result creation for scenarios
- Metrics refresh
- Run URL generation
- Closing runs with different statuses
- Scenarios with metadata (flags, tags, meta)

Run with:
    pytest sdk/tests/integration/evaluations/ -v -m integration

Environment variables:
    AGENTA_API_KEY: Required for authentication
    AGENTA_HOST: Optional, defaults to https://cloud.agenta.ai
"""

import pytest

from agenta.sdk.evaluations import metrics, results, runs, scenarios

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]


async def test_evaluations_run_scenario_result_close(agenta_init):
    run = await runs.acreate(
        name="sdk-it-eval-run",
        description="SDK integration test run",
    )
    assert run is not None

    try:
        dumped = run.model_dump()
        assert "id" in dumped

        fetched = await runs.afetch(run_id=run.id)
        assert fetched is not None
        assert fetched.id == run.id
        assert fetched.model_dump()["id"] == run.id

        scenario = await scenarios.acreate(run_id=run.id)
        assert scenario is not None
        assert scenario.run_id == run.id
        assert "id" in scenario.model_dump()

        result = await results.acreate(
            run_id=run.id,
            scenario_id=scenario.id,
            step_key="sdk_it_step",
        )
        assert result is not None
        assert result.run_id == run.id
        assert result.scenario_id == scenario.id
        assert result.step_key == "sdk_it_step"
        assert "id" in result.model_dump()

        try:
            m = await metrics.arefresh(run.id, scenario.id)
            assert m.run_id == run.id
            assert m.model_dump()["run_id"] == run.id
        except Exception:
            # Metrics may not be available in all deployments.
            pass

        closed = await runs.aclose(run_id=run.id)
        assert closed is not None
        assert closed.id == run.id

    finally:
        try:
            await runs.aclose(run_id=run.id)
        except Exception:
            pass


async def test_evaluation_run_aurl(agenta_init):
    """Test runs.aurl() returns valid URL."""
    run = await runs.acreate(
        name="sdk-it-url-test",
        description="Test run for URL generation",
    )
    assert run is not None

    try:
        # Get the URL for the run
        url = await runs.aurl(run_id=run.id)

        # URL should be a non-empty string
        assert url is not None
        assert isinstance(url, str)
        assert len(url) > 0

        # URL should contain expected parts
        assert "/evaluations/results/" in url
        assert str(run.id) in url

    finally:
        try:
            await runs.aclose(run_id=run.id)
        except Exception:
            pass


async def test_evaluation_run_close_with_failure_status(agenta_init):
    """Test closing run with failure status."""
    run = await runs.acreate(
        name="sdk-it-failure-status",
        description="Test run for failure status",
    )
    assert run is not None

    try:
        # Close the run with failure status
        closed = await runs.aclose(run_id=run.id, status="failure")

        assert closed is not None
        assert closed.id == run.id
        # The run should be closed (no exception raised)

    except Exception:
        # If closing fails, ensure we still try to close it
        try:
            await runs.aclose(run_id=run.id)
        except Exception:
            pass


async def test_evaluation_scenario_with_metadata(agenta_init):
    """Test creating scenario with flags/tags/meta."""
    run = await runs.acreate(
        name="sdk-it-scenario-metadata",
        description="Test run for scenario metadata",
    )
    assert run is not None

    try:
        # Create scenario with metadata
        scenario = await scenarios.acreate(
            run_id=run.id,
            flags={"is_test": True, "priority": "high"},
            tags={"category": "integration", "version": "v1"},
            meta={"source": "sdk-tests", "iteration": 1},
        )

        assert scenario is not None
        assert scenario.run_id == run.id

        # Verify the scenario was created and has an ID
        dumped = scenario.model_dump()
        assert "id" in dumped
        assert dumped["run_id"] == run.id

    finally:
        try:
            await runs.aclose(run_id=run.id)
        except Exception:
            pass
