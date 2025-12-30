"""FastAPI router for organization security features."""

from typing import List
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from oss.src.services.auth_service import authorization_check
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


router = APIRouter()
domain_service = DomainVerificationService()
provider_service = SSOProviderService()


# Domain Verification Endpoints

@router.post("/domains", response_model=OrganizationDomainResponse, status_code=201)
async def create_domain(
    payload: OrganizationDomainCreate,
    request: Request,
    _=Depends(authorization_check),
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

    domain = await domain_service.create_domain(organization_id, payload, user_id)

    # Include verification instructions in response
    instructions = domain_service.get_verification_instructions(
        domain.slug, domain.token
    )

    return JSONResponse(
        status_code=201,
        content={
            **domain.model_dump(mode="json"),
            "verification_instructions": instructions,
        },
    )


@router.post("/domains/verify", response_model=OrganizationDomainResponse)
async def verify_domain(
    payload: OrganizationDomainVerify,
    request: Request,
    _=Depends(authorization_check),
):
    """
    Verify domain ownership via DNS TXT record.

    This endpoint checks for the presence of the verification TXT record
    and marks the domain as verified if found.
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    return await domain_service.verify_domain(
        organization_id, payload.domain_id, user_id
    )


@router.get("/domains", response_model=List[OrganizationDomainResponse])
async def list_domains(
    request: Request,
    _=Depends(authorization_check),
):
    """List all domains for the organization."""
    organization_id = request.state.organization_id
    return await domain_service.list_domains(organization_id)


@router.delete("/domains/{domain_id}", status_code=204)
async def delete_domain(
    domain_id: str,
    request: Request,
    _=Depends(authorization_check),
):
    """Delete a domain."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await domain_service.delete_domain(organization_id, domain_id, user_id)
    return JSONResponse(status_code=204, content=None)


# SSO Provider Endpoints

@router.post("/providers", response_model=OrganizationProviderResponse, status_code=201)
async def create_provider(
    payload: OrganizationProviderCreate,
    request: Request,
    _=Depends(authorization_check),
):
    """
    Create a new SSO provider configuration.

    Supported provider types:
    - oidc: OpenID Connect
    - saml: SAML 2.0 (coming soon)
    """
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    return await provider_service.create_provider(organization_id, payload, user_id)


@router.patch("/providers/{provider_id}", response_model=OrganizationProviderResponse)
async def update_provider(
    provider_id: str,
    payload: OrganizationProviderUpdate,
    request: Request,
    _=Depends(authorization_check),
):
    """Update an SSO provider configuration."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    return await provider_service.update_provider(
        organization_id, provider_id, payload, user_id
    )


@router.get("/providers", response_model=List[OrganizationProviderResponse])
async def list_providers(
    request: Request,
    _=Depends(authorization_check),
):
    """List all SSO providers for the organization."""
    organization_id = request.state.organization_id
    return await provider_service.list_providers(organization_id)


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(
    provider_id: str,
    request: Request,
    _=Depends(authorization_check),
):
    """Delete an SSO provider configuration."""
    organization_id = request.state.organization_id
    user_id = request.state.user_id

    await provider_service.delete_provider(organization_id, provider_id, user_id)
    return JSONResponse(status_code=204, content=None)
