from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_harness,
    get_workflow_catalog_harnesses,
)


def test_harness_list_leaves_out_the_mock_test_harness():
    keys = {harness.key for harness in get_workflow_catalog_harnesses()}

    assert keys == {"pi_core", "claude", "codex"}


def test_mock_harness_is_still_fetchable_by_id():
    # Tests bind agents to the mock by id, and the web resolves a config's own harness through
    # this route, so hiding it from the list must not 404 it.
    harness = get_workflow_catalog_harness(ag_harness="mock")

    assert harness is not None
    assert harness.key == "mock"
    assert harness.capabilities["providers"] == ["mock"]
