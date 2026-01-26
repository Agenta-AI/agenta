import pytest

from agenta.sdk.evaluations import metrics, results, runs, scenarios

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


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
