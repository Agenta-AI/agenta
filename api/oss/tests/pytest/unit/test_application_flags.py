from oss.src.core.applications.dtos import ApplicationFlags as ApiApplicationFlags
from agenta.sdk.models.workflows import ApplicationFlags as SdkApplicationFlags


def test_api_application_flags_only_force_is_application():
    flags = ApiApplicationFlags(is_evaluator=True, is_snippet=True)

    assert flags.is_application is True
    assert flags.is_evaluator is True
    assert flags.is_snippet is True


def test_sdk_application_flags_only_force_is_application():
    flags = SdkApplicationFlags(is_evaluator=True, is_snippet=True)

    assert flags.is_application is True
    assert flags.is_evaluator is True
    assert flags.is_snippet is True
