from oss.databases.postgres.migrations.core.data_migrations.workflow_revisions import (
    REVISION_FLAG_KEYS,
    _extract_outputs_schema_from_service_format,
    _backfill_schemas_from_interface,
    _backfill_schemas_outputs_from_service_format,
    _has_messages_input,
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


def test_normalize_revision_flags_infers_is_chat_from_messages_input_schema():
    flags = _normalize_revision_flags(
        legacy_flags=None,
        data={
            "uri": "user:custom:local:latest",
            "schemas": {
                "inputs": {
                    "type": "object",
                    "properties": {
                        "messages": {"x-ag-type-ref": "messages", "type": "array"},
                    },
                }
            },
        },
    )

    assert flags["is_chat"] is True


def test_has_messages_input_detects_messages_type_ref():
    assert (
        _has_messages_input(
            {
                "type": "object",
                "properties": {"messages": {"x-ag-type-ref": "messages"}},
            }
        )
        is True
    )


def test_has_messages_input_detects_message_type_ref():
    assert (
        _has_messages_input(
            {
                "type": "object",
                "properties": {"chat": {"x-ag-type-ref": "message"}},
            }
        )
        is True
    )


def test_has_messages_input_returns_false_for_non_chat_schema():
    assert (
        _has_messages_input(
            {
                "type": "object",
                "properties": {"prompt": {"type": "string"}},
            }
        )
        is False
    )


def test_has_messages_input_returns_false_for_none():
    assert _has_messages_input(None) is False


def test_backfill_schemas_from_interface_adds_builtin_chat_schemas():
    data = _backfill_schemas_from_interface({"uri": "agenta:builtin:chat:v0"})

    assert data["schemas"]["outputs"] is not None
    assert data["schemas"]["parameters"] is not None
    assert data["schemas"]["inputs"] is not None


def test_backfill_schemas_from_interface_adds_exact_match_parameters_schema():
    data = _backfill_schemas_from_interface(
        {"uri": "agenta:builtin:auto_exact_match:v0"}
    )

    assert data["schemas"]["outputs"] is not None
    assert data["schemas"]["parameters"] is not None
    assert "inputs" not in data["schemas"]


def test_backfill_schemas_from_interface_adds_contains_json_parameters_schema():
    data = _backfill_schemas_from_interface(
        {"uri": "agenta:builtin:auto_contains_json:v0"}
    )

    assert data["schemas"]["outputs"] is not None
    assert data["schemas"]["parameters"] is not None
    assert "inputs" not in data["schemas"]


def test_backfill_schemas_outputs_from_service_format_for_feedback_rows():
    data = _backfill_schemas_outputs_from_service_format(
        {
            "uri": "agenta:custom:feedback:v0",
            "service": {
                "format": {
                    "type": "object",
                    "properties": {
                        "outputs": {
                            "type": "object",
                            "properties": {"approved": {"type": "boolean"}},
                            "required": ["approved"],
                        }
                    },
                    "required": ["outputs"],
                }
            },
        }
    )

    assert data["schemas"]["outputs"] == {
        "type": "object",
        "properties": {"approved": {"type": "boolean"}},
        "required": ["approved"],
    }


def test_extract_outputs_schema_from_service_format_skips_direct_schema():
    outputs_schema = _extract_outputs_schema_from_service_format(
        {
            "type": "object",
            "properties": {"approved": {"type": "boolean"}},
            "required": ["approved"],
        }
    )

    assert outputs_schema is None


def test_backfill_schemas_outputs_from_service_format_skips_direct_schema_rows():
    data = _backfill_schemas_outputs_from_service_format(
        {
            "uri": "agenta:custom:feedback:v0",
            "service": {
                "format": {
                    "type": "object",
                    "properties": {"approved": {"type": "boolean"}},
                    "required": ["approved"],
                }
            },
        }
    )

    assert data.get("schemas") is None


def test_backfill_schemas_from_interface_keeps_feedback_service_outputs():
    data = _backfill_schemas_from_interface(
        {
            "uri": "agenta:custom:feedback:v0",
            "service": {
                "format": {
                    "type": "object",
                    "properties": {
                        "outputs": {
                            "type": "object",
                            "properties": {"approved": {"type": "boolean"}},
                            "required": ["approved"],
                        }
                    },
                    "required": ["outputs"],
                }
            },
        }
    )

    assert data["schemas"]["outputs"] == {
        "type": "object",
        "properties": {"approved": {"type": "boolean"}},
        "required": ["approved"],
    }


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


def test_upgrade_workflow_revisions_extracts_service_outputs_before_stripping_service():
    session = _FakeSession()

    upgrade_workflow_revisions(session)

    assert any(
        "service' -> 'format' -> 'properties' -> 'outputs'" in statement
        and "'outputs'," in statement
        and "'schemas'," in statement
        for statement, _params in session.statements
    )


def test_upgrade_workflow_revisions_uses_custom_uris_for_hook_and_code():
    session = _FakeSession()

    upgrade_workflow_revisions(session)

    statements = "\n".join(statement for statement, _params in session.statements)

    assert "agenta:custom:hook:v0" in statements
    assert "agenta:custom:code:v0" in statements
    assert "'{uri}'" in statements
    assert '"agenta:custom:hook:v0"' in statements
    assert '"agenta:custom:code:v0"' in statements


def test_upgrade_workflow_revisions_drops_legacy_data_version_key():
    session = _FakeSession()

    upgrade_workflow_revisions(session)

    assert any(
        "SET data = (data::jsonb - 'version')::json" in statement
        for statement, _params in session.statements
    )


def test_upgrade_workflow_revisions_clears_workflow_meta_content():
    session = _FakeSession()

    upgrade_workflow_revisions(session)

    statements = "\n".join(statement for statement, _params in session.statements)

    assert "UPDATE workflow_artifacts SET meta = NULL" in statements
    assert "UPDATE workflow_variants SET meta = NULL" in statements
    assert "UPDATE workflow_revisions SET meta = NULL" in statements
