from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.agent_secret_leases.models import (
    ClaimResponse,
    LeaseResponse,
)
from oss.src.core.agent_secret_leases.dtos import (
    AgentSecretLease,
    LeaseClaim,
    LeaseMutation,
    LeasePage,
    LeaseQuery,
    LeaseReserve,
    LeaseResource,
    TenantScope,
)
from oss.src.core.agent_secret_leases.interfaces import AgentSecretLeasesDAOInterface
from oss.src.core.agent_secret_leases.service import (
    AgentSecretLeasesService,
    compute_plan_digest,
    validate_mutation,
)
from oss.src.core.agent_secret_leases.types import LeaseConflict, LeaseInvalid


NOW = datetime.now(timezone.utc)
DIGEST = "hmac-sha256:" + "b" * 64


def scope():
    return TenantScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def reservation():
    return LeaseReserve.model_validate(
        {
            "owner": {"kind": "session", "id": "session-1"},
            "idempotency_key": "opaque-key-123456",
            "credential_epoch_digest": DIGEST,
            "resources": [
                {
                    "consumer": {"kind": "model"},
                    "binding": {"kind": "environment", "name": "OPENAI_API_KEY"},
                    "usage": "opaque_http",
                    "allowed_host": "api.openai.com",
                }
            ],
        }
    )


def make_lease(
    tenant, *, state="reserved", version=1, resource_state="planned", claim=False
):
    lease_id = uuid4()
    resource = LeaseResource(
        id=uuid4(),
        lease_id=lease_id,
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
        project_id=tenant.project_id,
        ordinal=0,
        consumer_kind="model",
        binding_kind="environment",
        binding_name="OPENAI_API_KEY",
        usage="opaque_http",
        allowed_host="api.openai.com",
        provider_secret_name=f"agenta_lease_{lease_id.hex}_0_deadbeef",
        provider_secret_id="provider-secret" if resource_state == "created" else None,
        state=resource_state,
        version=1,
        created_at=NOW,
    )
    return AgentSecretLease(
        id=lease_id,
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
        project_id=tenant.project_id,
        created_by_id=tenant.user_id,
        provider="daytona",
        owner_kind="session",
        owner_id="session-1",
        idempotency_key="opaque-key-123456",
        plan_digest="sha256:" + "c" * 64,
        credential_epoch_digest=DIGEST,
        sandbox_label=f"agenta.lease_id={lease_id}",
        state=state,
        version=version,
        attempt_count=0,
        claim_id=uuid4() if claim else None,
        claim_owner="janitor" if claim else None,
        claim_expires_at=NOW + timedelta(minutes=1) if claim else None,
        claim_generation=2 if claim else 0,
        created_at=NOW,
        resources=[resource],
        sandbox_id="sandbox-1" if state in ("active", "cleaning") else None,
    )


class FakeDAO(AgentSecretLeasesDAOInterface):
    def __init__(self, lease=None):
        self.lease = lease
        self.reserve_args = None

    async def reserve(self, **kwargs):
        self.reserve_args = kwargs
        return self.lease

    async def fetch(self, **kwargs):
        if self.lease is None:
            return None
        tenant = kwargs["scope"]
        if tenant and tenant.project_id != self.lease.project_id:
            return None
        return self.lease

    async def mutate(self, **kwargs):
        return self.lease

    async def query(self, **kwargs):
        return LeasePage(leases=[self.lease] if self.lease else [])

    async def claim(self, **kwargs):
        return LeaseClaim(
            claim_id=uuid4(),
            claim_generation=3,
            claim_expires_at=kwargs["claim_expires_at"],
        )


@pytest.mark.asyncio
async def test_reserve_derives_opaque_ids_and_non_secret_plan_digest():
    tenant = scope()
    dao = FakeDAO(make_lease(tenant))
    service = AgentSecretLeasesService(leases_dao=dao)
    await service.reserve(scope=tenant, reservation=reservation())
    args = dao.reserve_args
    assert args["scope"] == tenant
    assert args["sandbox_label"] == f"agenta.lease_id={args['lease_id']}"
    digest = compute_plan_digest(reservation())
    assert digest.startswith("sha256:")
    assert DIGEST not in digest
    assert "OPENAI_API_KEY" not in args["sandbox_label"]


@pytest.mark.asyncio
async def test_cross_project_retrieve_is_not_found():
    tenant = scope()
    service = AgentSecretLeasesService(leases_dao=FakeDAO(make_lease(tenant)))
    other = scope()
    with pytest.raises(Exception):
        await service.retrieve(lease_id=uuid4(), scope=other)


@pytest.mark.asyncio
async def test_activation_requires_sandbox_and_created_children_before_dao_mutation():
    tenant = scope()
    lease = make_lease(tenant, state="provisioning")
    dao = FakeDAO(lease)
    service = AgentSecretLeasesService(leases_dao=dao)
    mutation = LeaseMutation(expected_version=1, transition="activate")
    with pytest.raises(LeaseInvalid, match="activation_incomplete"):
        await service.mutate(lease_id=lease.id, scope=tenant, mutation=mutation)


@pytest.mark.asyncio
async def test_stale_version_and_stale_janitor_fence_fail():
    tenant = scope()
    lease = make_lease(tenant, state="cleaning", version=4, claim=True)
    service = AgentSecretLeasesService(leases_dao=FakeDAO(lease))
    with pytest.raises(LeaseConflict, match="stale_version"):
        await service.mutate(
            lease_id=lease.id,
            scope=tenant,
            mutation=LeaseMutation(expected_version=3, transition="requestCleanup"),
        )
    with pytest.raises(LeaseConflict, match="stale_claim"):
        await service.mutate(
            lease_id=lease.id,
            scope=None,
            janitor=True,
            mutation=LeaseMutation(
                expected_version=4,
                transition="recordRetry",
                claim={"id": uuid4(), "generation": 1},
                next_attempt_at=NOW + timedelta(minutes=1),
                error_code="provider_unavailable",
            ),
        )


@pytest.mark.asyncio
async def test_tenant_cannot_submit_organization_filter_but_janitor_can():
    tenant = scope()
    lease = make_lease(tenant)
    service = AgentSecretLeasesService(leases_dao=FakeDAO(lease))
    query = LeaseQuery(organization_id=uuid4())
    with pytest.raises(LeaseInvalid, match="organization_filter_not_allowed"):
        await service.query(scope=tenant, query=query)
    page = await service.query(scope=None, query=query, janitor=True)
    assert page.leases == [lease]


def test_record_sandbox_requires_only_a_sandbox_id_and_preserves_provisioning_source():
    tenant = scope()
    lease = make_lease(tenant, state="provisioning")
    mutation = LeaseMutation(
        expected_version=1, transition="recordSandbox", sandbox_id="sandbox-2"
    )
    validate_mutation(lease, mutation, require_claim=False)
    with pytest.raises(LeaseInvalid, match="invalid_record_sandbox"):
        validate_mutation(
            lease,
            LeaseMutation(expected_version=1, transition="recordSandbox"),
            require_claim=False,
        )


def test_http_lease_response_is_camel_case_without_changing_core_dump():
    lease = make_lease(scope())
    assert "organization_id" in lease.model_dump(mode="json")
    wire = LeaseResponse(count=1, lease=lease.model_dump()).model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    assert "organizationId" in wire["lease"]
    assert "organization_id" not in wire["lease"]
    assert "providerSecretName" in wire["lease"]["resources"][0]
    assert "provider_secret_name" not in wire["lease"]["resources"][0]


def test_claim_response_remains_claim_only_and_camel_case():
    wire = ClaimResponse(
        claim_id=uuid4(),
        claim_generation=3,
        claim_expires_at=NOW,
    ).model_dump(mode="json", by_alias=True)
    assert set(wire) == {"claimId", "claimGeneration", "claimExpiresAt"}


def test_in_phase_transitions_persist_one_child_cas_update_at_a_time():
    tenant = scope()
    provisioning = make_lease(tenant, state="provisioning")
    validate_mutation(
        provisioning,
        LeaseMutation(
            expected_version=1,
            transition="beginProvisioning",
            resource_updates=[
                {
                    "resource_id": provisioning.resources[0].id,
                    "expected_version": 1,
                    "provider_secret_id": "provider-secret",
                    "state": "created",
                }
            ],
        ),
        require_claim=False,
    )
    cleaning = make_lease(tenant, state="cleaning")
    validate_mutation(
        cleaning,
        LeaseMutation(
            expected_version=1,
            transition="beginCleanup",
            resource_updates=[
                {
                    "resource_id": cleaning.resources[0].id,
                    "expected_version": 1,
                    "state": "deleted",
                }
            ],
        ),
        require_claim=False,
    )


@pytest.mark.parametrize("error_code", ["provision_failed", "sandbox_create_failed"])
def test_request_cleanup_accepts_only_runner_failure_codes(error_code):
    lease = make_lease(scope(), state="provisioning")
    validate_mutation(
        lease,
        LeaseMutation(
            expected_version=1,
            transition="requestCleanup",
            error_code=error_code,
        ),
        require_claim=False,
    )
    with pytest.raises(LeaseInvalid, match="unexpected_transition_fields"):
        validate_mutation(
            lease,
            LeaseMutation(
                expected_version=1,
                transition="requestCleanup",
                error_code="provider_unavailable",
            ),
            require_claim=False,
        )
