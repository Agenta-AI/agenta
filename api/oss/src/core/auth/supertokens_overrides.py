"""SuperTokens override functions for dynamic OIDC providers and custom session handling."""

from typing import Dict, Any, List, Optional, Union
from uuid import UUID

from supertokens_python.recipe.thirdparty.provider import (
    Provider,
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
)
from supertokens_python.recipe.thirdparty.interfaces import (
    RecipeInterface as ThirdPartyRecipeInterface,
    APIInterface as ThirdPartyAPIInterface,
    SignInUpOkResult,
)
from supertokens_python.recipe.passwordless.interfaces import (
    RecipeInterface as PasswordlessRecipeInterface,
    ConsumeCodeOkResult,
)
from supertokens_python.recipe.session.interfaces import (
    RecipeInterface as SessionRecipeInterface,
)
from supertokens_python.types import User, RecipeUserId

from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.users.dao import IdentitiesDAO
from oss.src.core.users.types import UserIdentityCreate
from oss.src.services import db_manager


# DAOs for accessing user identities (always available)
identities_dao = IdentitiesDAO()

# Organization providers DAO (EE only)
if is_ee():
    from oss.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO

    providers_dao = OrganizationProvidersDAO()
else:
    providers_dao = None


async def get_dynamic_oidc_provider(third_party_id: str) -> Optional[ProviderInput]:
    """
    Fetch dynamic OIDC provider configuration from database (EE only).

    third_party_id format: "oidc:{organization_id}:{provider_slug}"
    """
    if not third_party_id.startswith("oidc:"):
        return None

    # OIDC providers require EE
    if not is_ee() or providers_dao is None:
        print(f"OIDC provider {third_party_id} requested but EE not enabled")
        return None

    try:
        # Parse third_party_id: "oidc:{org_id}:{provider_slug}"
        parts = third_party_id.split(":")
        if len(parts) != 3:
            return None

        org_id_str, provider_slug = parts[1], parts[2]
        org_id = UUID(org_id_str)

        # Fetch provider from database
        provider = await providers_dao.get_by_slug(org_id, provider_slug)
        if not provider or not (provider.flags and provider.flags.get("is_active")):
            return None

        # Extract OIDC config
        config = provider.settings
        issuer = config.get("issuer")
        client_id = config.get("client_id")
        client_secret = config.get("client_secret")
        scopes = config.get("scopes", ["openid", "profile", "email"])

        if not issuer or not client_id or not client_secret:
            return None

        # Build ProviderInput for SuperTokens
        return ProviderInput(
            config=ProviderConfig(
                third_party_id=third_party_id,
                clients=[
                    ProviderClientConfig(
                        client_id=client_id,
                        client_secret=client_secret,
                        scope=scopes,
                    )
                ],
                # OIDC discovery
                oidc_discovery_endpoint=f"{issuer}/.well-known/openid-configuration",
                # Explicit endpoints (optional, falls back to discovery)
                authorization_endpoint=config.get("authorization_endpoint"),
                token_endpoint=config.get("token_endpoint"),
                user_info_endpoint=config.get("userinfo_endpoint"),
            )
        )
    except Exception as e:
        # Log error but don't crash
        print(f"Error fetching dynamic OIDC provider {third_party_id}: {e}")
        return None


def override_thirdparty_functions(
    original_implementation: ThirdPartyRecipeInterface,
) -> ThirdPartyRecipeInterface:
    """Override third-party recipe functions to support dynamic providers."""

    original_sign_in_up = original_implementation.sign_in_up

    async def sign_in_up(
        third_party_id: str,
        third_party_user_id: str,
        email: str,
        is_verified: bool,
        oauth_tokens: Dict[str, Any],
        raw_user_info_from_provider: Dict[str, Any],
        session_data_in_database: Optional[Dict[str, Any]],
        user_context: Dict[str, Any],
    ) -> SignInUpOkResult:
        """
        Override sign_in_up to:
        1. Create user_identity record after successful authentication
        2. Populate session with identities array
        """
        # Call original implementation
        result = await original_sign_in_up(
            third_party_id=third_party_id,
            third_party_user_id=third_party_user_id,
            email=email,
            is_verified=is_verified,
            oauth_tokens=oauth_tokens,
            raw_user_info_from_provider=raw_user_info_from_provider,
            session_data_in_database=session_data_in_database,
            user_context=user_context,
        )

        # Determine method string based on third_party_id
        if third_party_id.startswith("oidc:"):
            # Format: oidc:{org_id}:{provider_slug} -> sso:{org_slug}:{provider_slug}
            parts = third_party_id.split(":")
            org_id_str, provider_slug = parts[1], parts[2]

            # Fetch organization to get slug (if available)
            try:
                org = await db_manager.get_organization_by_id(org_id_str)
                org_identifier = org.slug if org and org.slug else org_id_str
            except Exception as e:
                print(f"Error fetching organization for SSO method: {e}")
                org_identifier = org_id_str  # Fallback to org_id

            method = f"sso:{org_identifier}:{provider_slug}"
        elif third_party_id == "google":
            method = "social:google"
        elif third_party_id == "github":
            method = "social:github"
        else:
            method = f"social:{third_party_id}"

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=third_party_user_id,
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=UUID(result.user.id),
                        method=method,
                        subject=third_party_user_id,
                        domain=domain,
                        created_by_id=UUID(result.user.id),
                    )
                )
        except Exception as e:
            # Log error but don't block authentication
            print(f"Error creating user_identity: {e}")

        # Fetch all user identities for session payload
        try:
            all_identities = await identities_dao.list_by_user(UUID(result.user.id))
            identities_array = [identity.method for identity in all_identities]
        except Exception as e:
            print(f"Error fetching user identities: {e}")
            identities_array = [method]  # Fallback to current method only

        # Store identities in user_context for session creation
        user_context["identities"] = identities_array

        return result

    original_implementation.sign_in_up = sign_in_up
    return original_implementation


def override_thirdparty_apis(
    original_implementation: ThirdPartyAPIInterface,
) -> ThirdPartyAPIInterface:
    """Override third-party API interface if needed."""
    # For now, no API overrides needed
    return original_implementation


def override_session_functions(
    original_implementation: SessionRecipeInterface,
) -> SessionRecipeInterface:
    """Override session functions to include identities in payload."""

    original_create_new_session = original_implementation.create_new_session

    async def create_new_session(
        user_id: str,
        recipe_user_id: RecipeUserId,
        access_token_payload: Optional[Dict[str, Any]],
        session_data_in_database: Optional[Dict[str, Any]],
        disable_anti_csrf: Optional[bool],
        tenant_id: str,
        user_context: Dict[str, Any],
    ):
        """
        Override create_new_session to inject identities array into access token payload.
        """
        # Get identities from user_context (populated by sign_in_up override)
        identities = user_context.get("identities", [])

        # Merge with existing payload
        if access_token_payload is None:
            access_token_payload = {}

        access_token_payload["identities"] = identities

        # Call original implementation
        return await original_create_new_session(
            user_id=user_id,
            recipe_user_id=recipe_user_id,
            access_token_payload=access_token_payload,
            session_data_in_database=session_data_in_database,
            disable_anti_csrf=disable_anti_csrf,
            tenant_id=tenant_id,
            user_context=user_context,
        )

    original_implementation.create_new_session = create_new_session
    return original_implementation


def override_passwordless_functions(
    original_implementation: PasswordlessRecipeInterface,
) -> PasswordlessRecipeInterface:
    """Override passwordless recipe functions to track email:otp identity."""

    original_consume_code = original_implementation.consume_code

    async def consume_code(
        pre_auth_session_id: str,
        user_input_code: Optional[str],
        device_id: Optional[str],
        link_code: Optional[str],
        session: Optional[Any],
        should_try_linking_with_session_user: Optional[bool],
        tenant_id: str,
        user_context: Dict[str, Any],
    ) -> Union[ConsumeCodeOkResult, Any]:
        """
        Override consume_code to:
        1. Create user_identity record for email:otp after successful login
        2. Populate session with identities array
        """
        # Call original implementation
        result = await original_consume_code(
            pre_auth_session_id=pre_auth_session_id,
            user_input_code=user_input_code,
            device_id=device_id,
            link_code=link_code,
            session=session,
            should_try_linking_with_session_user=should_try_linking_with_session_user,
            tenant_id=tenant_id,
            user_context=user_context,
        )

        # Only process if successful
        if not isinstance(result, ConsumeCodeOkResult):
            return result

        # Determine method and subject
        method = "email:otp"
        user_id_str = result.user.id
        email = result.user.emails[0] if result.user.emails else None

        if not email:
            # Can't create identity without email
            user_context["identities"] = [method]
            return result

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=email,  # For email:otp, subject is the email
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=UUID(user_id_str),
                        method=method,
                        subject=email,
                        domain=domain,
                        created_by_id=UUID(user_id_str),
                    )
                )
        except Exception as e:
            # Log error but don't block authentication
            print(f"Error creating user_identity for passwordless: {e}")

        # Fetch all user identities for session payload
        try:
            all_identities = await identities_dao.list_by_user(UUID(user_id_str))
            identities_array = [identity.method for identity in all_identities]
        except Exception as e:
            print(f"Error fetching user identities: {e}")
            identities_array = [method]  # Fallback to current method only

        # Store identities in user_context for session creation
        user_context["identities"] = identities_array

        return result

    original_implementation.consume_code = consume_code
    return original_implementation
