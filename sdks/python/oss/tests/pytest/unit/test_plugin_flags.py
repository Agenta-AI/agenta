import pytest

from agenta.sdk.engines.running.utils import (
    AGENTA_CUSTOM_PLUGIN_URI,
    infer_flags_from_data,
)
from agenta.sdk.models.workflows import (
    WorkflowFlags,
    WorkflowQueryFlags,
    WorkflowRevisionData,
)


def test_flag_models_expose_is_plugin():
    assert WorkflowFlags().is_plugin is False
    assert WorkflowQueryFlags().is_plugin is None


def test_plugin_uri_derives_is_plugin_and_roles():
    flags = infer_flags_from_data(
        flags=None,
        data=WorkflowRevisionData(
            uri=AGENTA_CUSTOM_PLUGIN_URI,
            runtime="javascript",
            script="const operations = {};",
        ),
    )
    assert flags.is_plugin is True
    assert flags.is_application is True
    assert flags.is_evaluator is False
    assert flags.is_agent is False


@pytest.mark.parametrize(
    "uri",
    [
        "agenta:custom:code:v0",
        "agenta:custom:plugin:v1",
        "other:custom:plugin:v0",
    ],
)
def test_other_uris_are_not_plugins(uri):
    flags = infer_flags_from_data(
        flags=None, data=WorkflowRevisionData(uri=uri, script="x")
    )
    assert flags.is_plugin is False


def test_plugin_roles_survive_default_flags_from_simple_creation():
    flags = infer_flags_from_data(
        flags=WorkflowFlags(),
        data=WorkflowRevisionData(uri=AGENTA_CUSTOM_PLUGIN_URI),
    )
    assert flags.is_application
    assert not flags.is_evaluator
    assert not flags.is_snippet
