from oss.databases.postgres.migrations.core.data_migrations.workflow_revisions import (
    REVISION_FLAG_KEYS,
    _normalize_artifact_flags,
    _normalize_revision_flags,
    upgrade_workflow_revisions,
)


def test_normalize_artifact_flags_maps_non_evaluator_to_application():
    assert _normalize_artifact_flags(None) == {
        "is_application": True,
        "is_evaluator": False,
        "is_snippet": False,
    }

    assert _normalize_artifact_flags({"is_evaluator": True}) == {
        "is_application": False,
        "is_evaluator": True,
        "is_snippet": False,
    }


def test_normalize_revision_flags_backfills_all_revision_keys():
    flags = _normalize_revision_flags(
        legacy_flags={"is_chat": True, "is_evaluator": False},
        data={"uri": "agenta:builtin:chat:v0"},
    )

    assert tuple(flags.keys()) == REVISION_FLAG_KEYS
    assert flags == {
        "is_managed": True,
        "is_custom": False,
        "is_llm": False,
        "is_hook": False,
        "is_code": False,
        "is_match": False,
        "is_feedback": False,
        "is_chat": True,
        "has_url": True,
        "has_script": False,
        "has_handler": False,
    }


def test_normalize_revision_flags_defaults_missing_values_to_false():
    flags = _normalize_revision_flags(
        legacy_flags=None,
        data=None,
    )

    assert tuple(flags.keys()) == REVISION_FLAG_KEYS
    assert all(value is False for value in flags.values())


def test_normalize_revision_flags_accepts_legacy_is_human_feedback_flag():
    flags = _normalize_revision_flags(
        legacy_flags={"is_human": True},
        data={"uri": "agenta:custom:feedback:v0"},
    )

    assert tuple(flags.keys()) == REVISION_FLAG_KEYS
    assert flags["is_feedback"] is True


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self._rows


class _FakeSession:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params))
        if "SELECT project_id, id, data, flags" in str(statement):
            return _FakeResult([])
        return _FakeResult([])


def test_upgrade_workflow_revisions_explicitly_nulls_v0_data_and_flags():
    session = _FakeSession()

    upgrade_workflow_revisions(session)

    assert any(
        "SET\n          data = NULL,\n          flags = NULL\n        WHERE version = '0'"
        in statement
        for statement, _params in session.statements
    )
