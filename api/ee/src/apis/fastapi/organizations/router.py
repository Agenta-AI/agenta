"""FastAPI router for organization security features."""

from typing import List
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, Response

from ee.src.apis.fastapi.organizations.models import (
    OrganizationDomainCreate,
    OrganizationDomainVerify,
    OrganizationDomainResponse,
    OrganizationProviderCreate,
    OrganizationProviderUpdate,
    OrganizationProviderResponse,
)
from ee.src.services.organization_security_service import (
    DomainVerificationService,
    SSOProviderService,
)
from ee.src.utils.permissions import check_user_org_access
from ee.src.services.selectors import get_user_org_and_workspace_id


router = APIRouter()
domain_service = DomainVerificationService()
provider_service = SSOProviderService()


async def verify_user_org_access(user_id: str, organization_id: str) -> None:
    """Helper to verify user has access to organization."""
    user_org_data = await get_user_org_and_workspace_id(user_id)
    has_access = await check_user_org_access(user_org_data, organization_id)
    if not has_access:
        raise HTTPException(
            status_code=403, detail="You do not have access to this organization"
        )


# Domain Verification Endpoints


@router.post("/domains", response_model=OrganizationDomainResponse, status_code=201)
async def create_domain(
    payload: OrganizationDomainCreate,
    request: Request,
):
    """
    Create a new domain for verification.

    This endpoint initiates the domain verification process by:
    1. Creating a domain record
    2. Generating a unique verification token
    3. Returning DNS configuration instructions

    The user must add a DNS TXT record to verify ownership.
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    domain = await domain_service.create_domain(organization_id, payload, user_id)

    return JSONResponse(
        status_code=201,
        content=domain.model_dump(mode="json"),
    )


@router.post("/domains/verify", response_model=OrganizationDomainResponse)
async def verify_domain(
    payload: OrganizationDomainVerify,
    request: Request,
):
    """
    Verify domain ownership via DNS TXT record.

    This endpoint checks for the presence of the verification TXT record
    and marks the domain as verified if found.
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await domain_service.verify_domain(
        organization_id, payload.domain_id, user_id
    )


@router.get("/domains", response_model=List[OrganizationDomainResponse])
async def list_domains(
    request: Request,
):
    """List all domains for the organization."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await domain_service.list_domains(organization_id)


@router.post("/domains/{domain_id}/refresh", response_model=OrganizationDomainResponse)
async def refresh_domain_token(
    domain_id: str,
    request: Request,
):
    """
    Refresh the verification token for an unverified domain.

    Generates a new token and resets the 48-hour expiry window.
    This is useful when the original token has expired.
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await domain_service.refresh_token(organization_id, domain_id, user_id)


@router.post("/domains/{domain_id}/reset", response_model=OrganizationDomainResponse)
async def reset_domain(
    domain_id: str,
    request: Request,
):
    """
    Reset a verified domain to unverified state for re-verification.

    Generates a new token and marks the domain as unverified.
    This allows re-verification of already verified domains.
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await domain_service.reset_domain(organization_id, domain_id, user_id)


@router.delete("/domains/{domain_id}", status_code=204)
async def delete_domain(
    domain_id: str,
    request: Request,
):
    """Delete a domain."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    await domain_service.delete_domain(organization_id, domain_id, user_id)
    return Response(status_code=204)


# SSO Provider Endpoints


@router.post("/providers", response_model=OrganizationProviderResponse, status_code=201)
async def create_provider(
    payload: OrganizationProviderCreate,
    request: Request,
):
    """
    Create a new SSO provider configuration.

    Supported provider types:
    - oidc: OpenID Connect
    - saml: SAML 2.0 (coming soon)
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await provider_service.create_provider(organization_id, payload, user_id)


@router.patch("/providers/{provider_id}", response_model=OrganizationProviderResponse)
async def update_provider(
    provider_id: str,
    payload: OrganizationProviderUpdate,
    request: Request,
):
    """Update an SSO provider configuration."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await provider_service.update_provider(
        organization_id, provider_id, payload, user_id
    )


@router.get("/providers", response_model=List[OrganizationProviderResponse])
async def list_providers(
    request: Request,
):
    """List all SSO providers for the organization."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await provider_service.list_providers(organization_id)


@router.post(
    "/providers/{provider_id}/test", response_model=OrganizationProviderResponse
)
async def test_provider(
    provider_id: str,
    request: Request,
):
    """
    Test SSO provider connection.

    This endpoint tests the OIDC provider configuration by fetching the
    discovery document and validating required endpoints exist.
    If successful, marks the provider as valid (is_valid=true).
    If failed, marks as invalid and deactivates (is_valid=false, is_active=false).
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    return await provider_service.test_provider(organization_id, provider_id, user_id)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    request: Request,
):
    """Delete an SSO provider configuration."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await verify_user_org_access(user_id, organization_id)

    await provider_service.delete_provider(organization_id, provider_id, user_id)
    return Response(status_code=204)
