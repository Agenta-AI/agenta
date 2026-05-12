from datetime import datetime, timezone
from uuid import uuid4

from ee.src.apis.fastapi.organizations.models import (
    OrganizationDomainResponse,
    OrganizationProviderResponse,
)
from ee.src.core.organizations.types import OrganizationDomain, OrganizationProvider


def test_domain_response_accepts_uuid_backed_domain_dto():
    domain = OrganizationDomain(
        id=uuid4(),
        organization_id=uuid4(),
        slug="example.com",
        name="Example",
        description="Example domain",
        token="verify-me",
        flags={"is_verified": False},
        created_at=datetime.now(timezone.utc),
        updated_at=None,
    )

    response = OrganizationDomainResponse.model_validate(domain)

    dumped = response.model_dump(mode="json")
    assert isinstance(dumped["id"], str)
    assert isinstance(dumped["organization_id"], str)


def test_provider_response_accepts_uuid_backed_provider_dto():
    provider = OrganizationProvider(
        id=uuid4(),
        organization_id=uuid4(),
        slug="oidc",
        name="OIDC",
        description="OIDC provider",
        settings={"issuer_url": "https://issuer.example.com"},
        flags={"is_active": True, "is_valid": True},
        created_at=datetime.now(timezone.utc),
        updated_at=None,
    )

    response = OrganizationProviderResponse.model_validate(provider)

    dumped = response.model_dump(mode="json")
    assert isinstance(dumped["id"], str)
    assert isinstance(dumped["organization_id"], str)
