"""The resource policy is required in `AccessService` and registered by every process
(interfaces 3.3, technical design section 8)."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest

import entrypoints.access as access_entrypoint
import oss.src.core.access.service as access_module
import oss.src.core.memberships.service as memberships_module
import oss.src.core.sharing.service as sharing_module
from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    ResourceKind,
    ResourceRef,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService, get_access_service
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import (
    MembershipsService,
    get_memberships_service,
)
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.sharing.service import SharingService, get_sharing_service
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, RecordingRbac
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO


API_DIR = Path(__file__).resolve().parents[5]


def _reset_registries(monkeypatch) -> None:
    monkeypatch.setattr(access_module, "_access_service", None)
    monkeypatch.setattr(memberships_module, "_memberships_service", None)
    monkeypatch.setattr(sharing_module, "_sharing_service", None)


def _assert_policy_registered() -> None:
    access_service = get_access_service()
    sharing_service = get_sharing_service()
    assert isinstance(sharing_service, SharingService)
    assert access_service.resource_policy is sharing_service
    # The sharing service shares the memberships and principals the access service uses.
    assert sharing_service._memberships is get_memberships_service()
    assert sharing_service._memberships is access_service.memberships
    assert sharing_service._principals_dao is access_service.principals


async def _bob_is_denied_a_private_session() -> None:
    """Swap the Postgres DAOs of the registered services for in-memory ones (the
    wiring stays the registered one) and decide for Bob on Alice's private session."""

    from oss.tests.pytest.utils.memberships import make_summary  # noqa: PLC0415
    from oss.tests.pytest.utils.sharing import InMemorySharingDAO  # noqa: PLC0415

    access_service = get_access_service()
    sharing_service = get_sharing_service()

    memberships_dao = InMemoryMembershipsDAO()
    organization_id, project_id = uuid4(), uuid4()
    memberships_dao.add_project(
        make_summary(organization_id=organization_id, project_id=project_id)
    )
    alice, bob = uuid4(), uuid4()
    for user in (alice, bob):
        memberships_dao.add_organization_member(
            organization_id=organization_id, user_id=user, role="editor"
        )
        memberships_dao.add_project_member(
            project_id=project_id, user_id=user, role="editor"
        )
    memberships_service = access_service.memberships
    memberships_service._dao = memberships_dao
    principals = InMemoryPrincipalsDAO()
    for user in (alice, bob):
        principals.human(user)
    access_service._principals = principals
    access_service._rbac = RecordingRbac()
    sharing_dao = InMemorySharingDAO()
    sharing_service._dao = sharing_dao
    state = sharing_dao.add_session(
        project_id=project_id,
        policy=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=alice),
    )

    resource = ResourceRef(kind=ResourceKind.SESSION, id=state.session_id)
    bob_decision = await access_service.decide(
        authority=None,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=bob),
        action=Permission.VIEW_SESSIONS,
        project_id=project_id,
        resource=resource,
    )
    assert (bob_decision.allowed, bob_decision.reason) == (
        False,
        DecisionReason.RESOURCE_DENIED,
    )
    alice_decision = await access_service.decide(
        authority=None,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=alice),
        action=Permission.VIEW_SESSIONS,
        project_id=project_id,
        resource=resource,
    )
    assert alice_decision.allowed


class _StartupDone(BaseException):
    """Stops a worker's `main_async` right after `bootstrap_access()` (a BaseException,
    so the worker's `except Exception` does not swallow it)."""


def run_process_startup(process: str) -> None:
    """Run in a fresh interpreter: the process's real startup path, with external
    clients stubbed, then check the registered policy. Exits non-zero on failure."""

    if process == "entrypoints.routers":
        from unittest.mock import patch  # noqa: PLC0415

        # The API module bootstraps at import time; the migration check reads the
        # alembic scripts, stubbed as the other router unit tests do.
        with patch("alembic.script.ScriptDirectory.from_config", return_value=object()):
            import entrypoints.routers  # noqa: F401, PLC0415
    else:
        import importlib  # noqa: PLC0415

        worker = importlib.import_module(process)
        real_bootstrap = worker.bootstrap_access

        def _bootstrap_then_stop():
            real_bootstrap()
            raise _StartupDone()

        worker.bootstrap_access = _bootstrap_then_stop
        worker.warn_deprecated_env_vars = lambda: None
        worker.validate_required_env_vars = lambda: None
        worker.bootstrap_entitlements_services = lambda: None
        try:
            asyncio.run(worker.main_async())
        except _StartupDone:
            pass
        else:
            raise AssertionError(
                f"{process}.main_async() never called bootstrap_access"
            )

    _assert_policy_registered()
    asyncio.run(_bob_is_denied_a_private_session())
    print("RESOURCE_POLICY_REGISTERED")


# -- tests ----------------------------------------------------------------------------


def test_access_service_requires_resource_policy():
    with pytest.raises(TypeError):
        AccessService(
            memberships=MembershipsService(
                memberships_dao=InMemoryMembershipsDAO(),
                policy=MembershipPolicy.ORGANIZATION_WIDE,
            ),
            rbac=RecordingRbac(),
            principals=InMemoryPrincipalsDAO(),
        )


@pytest.mark.parametrize("license", ["oss", "ee"])
def test_every_root_passes_resource_policy(license, monkeypatch):
    monkeypatch.setattr(access_entrypoint, "is_ee", lambda: license == "ee")
    _reset_registries(monkeypatch)

    returned = access_entrypoint.bootstrap_access()

    assert get_access_service() is returned
    _assert_policy_registered()


@pytest.mark.parametrize(
    "process",
    ["entrypoints.routers", "entrypoints.worker_queues", "entrypoints.worker_streams"],
)
def test_each_process_registers_the_resource_policy(process):
    # A fresh interpreter per process: the API bootstraps at import time and the
    # workers set up global tracing on import, so neither runs inside this session.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from oss.tests.pytest.unit.sharing.test_composition_roots import "
            f"run_process_startup; run_process_startup({process!r})",
        ],
        cwd=API_DIR,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert result.returncode == 0, result.stderr[-4000:]
    assert "RESOURCE_POLICY_REGISTERED" in result.stdout
