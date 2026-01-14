from typing import Dict, Any, List, Optional, Union

from oss.src.utils.logging import get_module_logger

from supertokens_python.recipe.thirdparty.provider import (
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
)
from supertokens_python.recipe.thirdparty.interfaces import (
    RecipeInterface as ThirdPartyRecipeInterface,
    APIInterface as ThirdPartyAPIInterface,
    SignInUpOkResult,
)
from supertokens_python.recipe.thirdparty.recipe_implementation import (
    find_and_create_provider_instance,
)
from supertokens_python.recipe.passwordless.interfaces import (
    RecipeInterface as PasswordlessRecipeInterface,
    ConsumeCodeOkResult,
)
from supertokens_python.recipe.emailpassword.interfaces import (
    RecipeInterface as EmailPasswordRecipeInterface,
    SignInOkResult as EmailPasswordSignInOkResult,
    SignUpOkResult as EmailPasswordSignUpOkResult,
)
from supertokens_python.recipe.session.interfaces import (
    RecipeInterface as SessionRecipeInterface,
)
from supertokens_python.types import RecipeUserId


from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.users.dao import IdentitiesDAO
from oss.src.core.users.types import UserIdentityCreate
from oss.src.services import db_manager
from oss.src.core.auth.service import AuthService

from oss.src.services.db_manager import get_user_with_email

log = get_module_logger(__name__)

# DAOs for accessing user identities (always available)
identities_dao = IdentitiesDAO()

# Organization providers DAO (EE only)
if is_ee():
    from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO
    from oss.src.core.secrets.services import VaultService
    from oss.src.dbs.postgres.secrets.dao import SecretsDAO

    providers_dao = OrganizationProvidersDAO()
else:
    providers_dao = None

# Auth service for domain policy enforcement
auth_service = AuthService()


def _merge_session_identities(
    session: Optional[Any], method: Optional[str]
) -> List[str]:
    session_identities: List[str] = []
    if session is not None:
        try:
            payload = session.get_access_token_payload()
            session_identities = payload.get("session_identities") or []
        except Exception:
            session_identities = []
    if method:
        if method not in session_identities:
            session_identities = list(session_identities) + [method]
    return session_identities or ([method] if method else [])


async def get_dynamic_oidc_provider(third_party_id: str) -> Optional[ProviderInput]:
    """
    Fetch dynamic OIDC provider configuration from database (EE only).

    third_party_id format: "sso:{organization_slug}:{provider_slug}"
    """
    # OIDC providers require EE
    if not is_ee() or providers_dao is None:
        log.error(f"SSO provider {third_party_id} requested but EE not enabled")
        return None

    try:
        # Parse third_party_id: "sso:{organization_slug}:{provider_slug}"
        if not third_party_id.startswith("sso:"):
            return None

        parts = third_party_id.split(":", 2)
        if len(parts) != 3:
            return None

        _, organization_slug, provider_slug = parts

        organization = await db_manager.get_organization_by_slug(organization_slug)
        if not organization:
            return None

        # Fetch provider from database by organization_id and provider_slug
        provider = await providers_dao.get_by_slug(
            slug=provider_slug, organization_id=str(organization.id)
        )
        if not provider or not (provider.flags and provider.flags.get("is_active")):
            return None

        # Extract OIDC config
        vault_service = VaultService(SecretsDAO())
        secret = await vault_service.get_secret(
            secret_id=provider.secret_id,
            organization_id=organization.id,
        )
        if not secret:
            log.warning(f"Secret not found for provider id={provider.id}")
            return None

        data = secret.data
        provider_settings = None
        if hasattr(data, "provider"):
            provider_settings = data.provider.model_dump()
        elif isinstance(data, dict):
            provider_settings = data.get("provider")

        if not isinstance(provider_settings, dict):
            log.warning(f"Invalid provider secret format for provider id={provider.id}")
            return None

        issuer_url = provider_settings.get("issuer_url")
        client_id = provider_settings.get("client_id")
        client_secret = provider_settings.get("client_secret")
        scopes = provider_settings.get("scopes", ["openid", "profile", "email"])

        if not issuer_url or not client_id or not client_secret:
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
                oidc_discovery_endpoint=f"{issuer_url}/.well-known/openid-configuration",
            )
        )
    except Exception:
        # Log error but don't crash
        log.error(
            f"Error fetching dynamic OIDC provider {third_party_id}",
            exc_info=True,
        )
        return None


def override_thirdparty_functions(
    original_implementation: ThirdPartyRecipeInterface,
) -> ThirdPartyRecipeInterface:
    """Override third-party recipe functions to support dynamic providers."""

    original_sign_in_up = original_implementation.sign_in_up
    original_get_provider = original_implementation.get_provider

    async def sign_in_up(
        third_party_id: str,
        third_party_user_id: str,
        email: str,
        is_verified: bool,
        oauth_tokens: Dict[str, Any],
        raw_user_info_from_provider: Dict[str, Any],
        session: Optional[Any],
        should_try_linking_with_session_user: Optional[bool],
        tenant_id: str,
        user_context: Dict[str, Any],
    ) -> SignInUpOkResult:
        """
        Override sign_in_up to:
        1. Create user_identity record after successful authentication
        2. Populate session with user_identities array
        """
        internal_user = None
        # Call original implementation
        result = await original_sign_in_up(
            third_party_id=third_party_id,
            third_party_user_id=third_party_user_id,
            email=email,
            is_verified=is_verified,
            oauth_tokens=oauth_tokens,
            raw_user_info_from_provider=raw_user_info_from_provider,
            session=session,
            should_try_linking_with_session_user=should_try_linking_with_session_user,
            tenant_id=tenant_id,
            user_context=user_context,
        )

        # Determine method string based on third_party_id
        if third_party_id.startswith("sso:"):
            # Format: sso:{organization_slug}:{provider_slug}
            method = third_party_id
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
            # Get internal user ID from database (not SuperTokens ID)
            internal_user = await get_user_with_email(email)
            if not internal_user:
                raise Exception(f"User not found for email {email}")

            internal_user_id = internal_user.id

            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=third_party_user_id,
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=internal_user_id,
                        method=method,
                        subject=third_party_user_id,
                        domain=domain,
                    )
                )
        except Exception:
            # Log error but don't block authentication
            log.info("[AUTH] Identity not created", exc_info=True)

        # Fetch all user identities for session payload
        try:
            internal_user = await get_user_with_email(email)
            if internal_user:
                all_identities = await identities_dao.list_by_user(internal_user.id)
                identities_array = [identity.method for identity in all_identities]
            else:
                identities_array = [method]
        except Exception:
            identities_array = [method]  # Fallback to current method only

        # Store identity context for session creation
        # user_identities = all known methods for user
        # session_identities = methods verified in this session (accumulated)
        user_context["user_identities"] = identities_array
        session_identities = _merge_session_identities(session, method)
        user_context["session_identities"] = session_identities

        # Enforce domain-based policies (auto-join, domains-only)
        if internal_user:
            try:
                await auth_service.enforce_domain_policies(
                    email=email,
                    user_id=internal_user.id,
                )
            except Exception:
                log.error("[AUTH] Error enforcing domain policies", exc_info=True)

        return result

    original_implementation.sign_in_up = sign_in_up

    async def get_provider(
        third_party_id: str,
        client_type: Optional[str],
        tenant_id: str,
        user_context: Dict[str, Any],
    ):
        provider = await original_get_provider(
            third_party_id=third_party_id,
            client_type=client_type,
            tenant_id=tenant_id,
            user_context=user_context,
        )
        if provider is not None:
            return provider

        if not third_party_id.startswith("sso:"):
            return None

        provider_input = await get_dynamic_oidc_provider(third_party_id)
        if provider_input is None:
            return None

        return await find_and_create_provider_instance(
            [provider_input],
            third_party_id,
            client_type,
            user_context,
        )

    original_implementation.get_provider = get_provider
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
        Override create_new_session to inject user_identities array into access token payload.
        """
        # Get identity context from user_context (populated by auth overrides)
        user_identities = user_context.get("user_identities", [])
        session_identities = user_context.get("session_identities", user_identities)

        # Merge with existing payload
        if access_token_payload is None:
            access_token_payload = {}

        access_token_payload["user_identities"] = user_identities
        access_token_payload["session_identities"] = session_identities

        # Call original implementation
        result = await original_create_new_session(
            user_id=user_id,
            recipe_user_id=recipe_user_id,
            access_token_payload=access_token_payload,
            session_data_in_database=session_data_in_database,
            disable_anti_csrf=disable_anti_csrf,
            tenant_id=tenant_id,
            user_context=user_context,
        )

        return result

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
        2. Populate session with user_identities array
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
            user_context["user_identities"] = [method]
            session_identities = _merge_session_identities(session, method)
            user_context["session_identities"] = session_identities
            return result

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            # Get internal user ID from database (not SuperTokens ID)
            internal_user = await get_user_with_email(email)
            if not internal_user:
                raise Exception(f"User not found for email {email}")

            internal_user_id = internal_user.id

            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=email,  # For email:otp, subject is the email
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=internal_user_id,
                        method=method,
                        subject=email,
                        domain=domain,
                        # created_by_id is optional, leaving it as None
                    )
                )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            internal_user = await get_user_with_email(email)
            if internal_user:
                all_identities = await identities_dao.list_by_user(internal_user.id)
                identities_array = [identity.method for identity in all_identities]
            else:
                identities_array = [method]
        except Exception:
            identities_array = [method]  # Fallback to current method only

        # Store identity context for session creation
        # user_identities = all known methods for user
        # session_identities = methods verified in this session (accumulated)
        user_context["user_identities"] = identities_array
        session_identities = _merge_session_identities(session, method)
        user_context["session_identities"] = session_identities

        # Enforce domain-based policies (auto-join, domains-only)
        if internal_user:
            try:
                await auth_service.enforce_domain_policies(
                    email=email,
                    user_id=internal_user.id,
                )
            except Exception:
                log.error("[AUTH] Error enforcing domain policies", exc_info=True)

        return result

    original_implementation.consume_code = consume_code
    return original_implementation


def override_emailpassword_functions(
    original_implementation: EmailPasswordRecipeInterface,
) -> EmailPasswordRecipeInterface:
    """Override email/password recipe functions to track email:password identity."""

    original_sign_in = original_implementation.sign_in
    original_sign_up = original_implementation.sign_up

    async def sign_in(
        email: str,
        password: str,
        tenant_id: str,
        session: Optional[Any],
        should_try_linking_with_session_user: Optional[bool],
        user_context: Dict[str, Any],
    ) -> Union[EmailPasswordSignInOkResult, Any]:
        """
        Override sign_in to:
        1. Create user_identity record for email:password after successful login
        2. Populate session with user_identities array
        """

        # Call original implementation
        result = await original_sign_in(
            email=email,
            password=password,
            tenant_id=tenant_id,
            session=session,
            should_try_linking_with_session_user=should_try_linking_with_session_user,
            user_context=user_context,
        )

        # Only process if successful
        if not isinstance(result, EmailPasswordSignInOkResult):
            return result

        # Method for email/password
        method = "email:password"

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            # Get internal user ID from database (not SuperTokens ID)
            internal_user = await get_user_with_email(email)
            if not internal_user:
                raise Exception(f"User not found for email {email}")

            internal_user_id = internal_user.id

            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=email,  # For email:password, subject is the email
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=internal_user_id,
                        method=method,
                        subject=email,
                        domain=domain,
                        # created_by_id is optional, leaving it as None
                    )
                )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            internal_user = await get_user_with_email(email)
            if internal_user:
                all_identities = await identities_dao.list_by_user(internal_user.id)
                identities_array = [identity.method for identity in all_identities]
            else:
                identities_array = [method]
        except Exception:
            identities_array = [method]  # Fallback to current method only

        # Store identity context for session creation
        # user_identities = all known methods for user
        # session_identities = methods verified in this session (accumulated)
        user_context["user_identities"] = identities_array
        session_identities = _merge_session_identities(session, method)
        user_context["session_identities"] = session_identities

        # Enforce domain-based policies (auto-join, domains-only)
        if internal_user:
            try:
                await auth_service.enforce_domain_policies(
                    email=email,
                    user_id=internal_user.id,
                )
            except Exception:
                log.error("[AUTH] Error enforcing domain policies", exc_info=True)

        return result

    async def sign_up(
        email: str,
        password: str,
        tenant_id: str,
        session: Optional[Any],
        should_try_linking_with_session_user: Optional[bool],
        user_context: Dict[str, Any],
    ) -> Union[EmailPasswordSignUpOkResult, Any]:
        """
        Override sign_up to:
        1. Create user_identity record for email:password after successful signup
        2. Populate session with user_identities array
        """

        # Call original implementation
        result = await original_sign_up(
            email=email,
            password=password,
            tenant_id=tenant_id,
            session=session,
            should_try_linking_with_session_user=should_try_linking_with_session_user,
            user_context=user_context,
        )

        # Only process if successful
        if not isinstance(result, EmailPasswordSignUpOkResult):
            return result

        # Method for email/password
        method = "email:password"

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            # Get internal user ID from database (not SuperTokens ID)
            internal_user = await get_user_with_email(email)
            if not internal_user:
                raise Exception(f"User not found for email {email}")

            internal_user_id = internal_user.id

            # Check if identity already exists
            existing = await identities_dao.get_by_method_subject(
                method=method,
                subject=email,  # For email:password, subject is the email
            )

            if not existing:
                # Create new identity
                await identities_dao.create(
                    UserIdentityCreate(
                        user_id=internal_user_id,
                        method=method,
                        subject=email,
                        domain=domain,
                        # created_by_id is optional, leaving it as None
                    )
                )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            internal_user = await get_user_with_email(email)
            if internal_user:
                all_identities = await identities_dao.list_by_user(internal_user.id)
                identities_array = [identity.method for identity in all_identities]
            else:
                identities_array = [method]
        except Exception:
            identities_array = [method]  # Fallback to current method only

        # Store identity context for session creation
        # user_identities = all known methods for user
        # session_identities = methods verified in this session (accumulated)
        user_context["user_identities"] = identities_array
        session_identities = _merge_session_identities(session, method)
        user_context["session_identities"] = session_identities

        # Enforce domain-based policies (auto-join, domains-only)
        if internal_user:
            try:
                await auth_service.enforce_domain_policies(
                    email=email,
                    user_id=internal_user.id,
                )
            except Exception:
                log.error("[AUTH] Error enforcing domain policies", exc_info=True)

        return result

    original_implementation.sign_in = sign_in
    original_implementation.sign_up = sign_up
    return original_implementation
