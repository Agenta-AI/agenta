from types import SimpleNamespace
from unittest.mock import AsyncMock


from oss.src.apis.fastapi.workflows import router as router_module
from oss.src.apis.fastapi.workflows.router import (
    _changes_sandbox_credentials,
    _require_fork_secret_attachment_access,
    _require_secret_attachment_access,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.shared.dtos import Reference
from oss.src.apis.fastapi.workflows.models import WorkflowVariantForkRequest
from oss.src.core.workflows.dtos import WorkflowVariantFork


def test_detects_credentials_in_full_agent_revision():
    assert _changes_sandbox_credentials(
        {"data": {"parameters": {"agent": {"sandbox": {"credentials": []}}}}}
    )


def test_detects_credentials_in_ordered_delta_path():
    assert _changes_sandbox_credentials(
        {
            "delta": {
                "operations": [
                    {"path": ["parameters", "agent", "sandbox", "credentials"]}
                ]
            }
        }
    )


def test_detects_credentials_in_legacy_delta_path():
    assert _changes_sandbox_credentials(
        {"delta": {"set": {"parameters.agent.sandbox.credentials": []}}}
    )


def test_ignores_unrelated_workflow_changes():
    assert not _changes_sandbox_credentials(
        {"delta": {"operations": [{"path": ["parameters", "agent", "instructions"]}]}}
    )


def test_ignores_sandbox_credentials_mentioned_in_instruction_text():
    assert not _changes_sandbox_credentials(
        {
            "data": {
                "parameters": {
                    "agent": {
                        "instructions": {
                            "agents_md": "Document sandbox.credentials without changing it."
                        }
                    }
                }
            }
        }
    )


async def test_attachment_requires_edit_secret(monkeypatch):
    check = AsyncMock(return_value=True)
    monkeypatch.setattr(router_module, "check_action_access", check)
    request = SimpleNamespace(
        state=SimpleNamespace(user_id="user", project_id="project")
    )
    await _require_secret_attachment_access(
        request, {"parameters": {"agent": {"sandbox": {"credentials": []}}}}
    )
    check.assert_awaited_once_with(
        user_uid="user", project_id="project", permission=Permission.EDIT_SECRET
    )


async def test_unrelated_revision_does_not_require_edit_secret(monkeypatch):
    check = AsyncMock()
    monkeypatch.setattr(router_module, "check_action_access", check)
    request = SimpleNamespace(
        state=SimpleNamespace(user_id="user", project_id="project")
    )
    await _require_secret_attachment_access(
        request, {"parameters": {"agent": {"instructions": {"agents_md": "x"}}}}
    )
    check.assert_not_awaited()


async def test_fork_of_credential_bearing_revision_requires_edit_secret(monkeypatch):
    check = AsyncMock(return_value=False)
    monkeypatch.setattr(router_module, "check_action_access", check)
    service = SimpleNamespace(
        fetch_workflow_revision=AsyncMock(
            return_value={
                "data": {"parameters": {"agent": {"sandbox": {"credentials": []}}}}
            }
        )
    )
    request = SimpleNamespace(
        state=SimpleNamespace(
            user_id="user", project_id="00000000-0000-0000-0000-000000000001"
        )
    )
    fork_request = WorkflowVariantForkRequest(
        workflow_variant=WorkflowVariantFork(slug="forked"),
        workflow_variant_ref=Reference(slug="source"),
    )

    try:
        await _require_fork_secret_attachment_access(request, service, fork_request)
    except Exception as exc:
        assert exc is router_module.FORBIDDEN_EXCEPTION
    else:
        raise AssertionError("credential-bearing fork should require EDIT_SECRET")

    service.fetch_workflow_revision.assert_awaited_once()
    check.assert_awaited_once_with(
        user_uid="user",
        project_id="00000000-0000-0000-0000-000000000001",
        permission=Permission.EDIT_SECRET,
    )
