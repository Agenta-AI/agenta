from typing import Dict, Any, List, Optional, Union, Set
from urllib.parse import urlparse

import posthog

from oss.src.utils.logging import get_module_logger

from supertokens_python.recipe.thirdparty.provider import (
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
    Provider,
    RedirectUriInfo,
)
from supertokens_python.recipe.thirdparty.interfaces import (
    RecipeInterface as ThirdPartyRecipeInterface,
    APIInterface as ThirdPartyAPIInterface,
    SignInUpOkResult,
    APIOptions,
)
from supertokens_python.recipe.thirdparty.recipe_implementation import (
    find_and_create_provider_instance,
)
from supertokens_python.asyncio import (
    list_users_by_account_info,
    get_user as get_user_from_supertokens,
)
from supertokens_python.recipe.passwordless.interfaces import (
    RecipeInterface as PasswordlessRecipeInterface,
    ConsumeCodeOkResult,
)
from supertokens_python.recipe.emailpassword.interfaces import (
    RecipeInterface as EmailPasswordRecipeInterface,
    APIInterface as EmailPasswordAPIInterface,
    APIOptions as EmailPasswordAPIOptions,
    SignInOkResult as EmailPasswordSignInOkResult,
    SignUpOkResult as EmailPasswordSignUpOkResult,
)
from supertokens_python.recipe.emailpassword.types import FormField
from supertokens_python.recipe.session.interfaces import (
    RecipeInterface as SessionRecipeInterface,
)
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.types import RecipeUserId, AccountInfo


from oss.src.utils.common import is_ee
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.validators import is_input_email
from oss.src.dbs.postgres.users.dao import IdentitiesDAO
from oss.src.core.users.types import UserIdentityCreate
from oss.src.services import db_manager
from oss.src.core.auth.service import AuthService

from oss.src.services.exceptions import UnauthorizedException
from oss.src.services.db_manager import (
    get_user_with_email,
    check_if_user_invitation_exists,
    is_first_user_signup,
    get_oss_organization,
    setup_oss_organization_for_first_user,
)

log = get_module_logger(__name__)

# DAOs for accessing user identities (always available)
identities_dao = IdentitiesDAO()

# Organization providers DAO (EE only)
if is_ee():
    from ee.src.dbs.postgres.organizations.dao import OrganizationProvidersDAO
    from ee.src.services.commoners import create_accounts
    from oss.src.core.secrets.services import VaultService
    from oss.src.dbs.postgres.secrets.dao import SecretsDAO

    providers_dao = OrganizationProvidersDAO()
else:
    from oss.src.services.db_manager import create_accounts

    providers_dao = None

# Auth service for domain policy enforcement
auth_service = AuthService()


def _get_signup_cloud_url() -> str:
    return env.agenta.web_url or env.agenta.api_url


def _get_signup_cloud_region(cloud_url: str) -> str:
    try:
        parsed = urlparse(cloud_url if "://" in cloud_url else f"https://{cloud_url}")
        hostname = (parsed.hostname or "").lower()
    except Exception:
        hostname = ""

    if (
        hostname == "cloud.agenta.ai"
        or hostname == "eu.cloud.agenta.ai"
        or hostname.endswith(".eu.cloud.agenta.ai")
        or hostname == "staging.preview.agenta.dev"
    ):
        return "EU"

    if (
        hostname == "us.cloud.agenta.ai"
        or hostname.endswith(".us.cloud.agenta.ai")
        or hostname == "testing.preview.agenta.dev"
    ):
        return "US"

    return "Other"


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


async def _get_blocked_domains() -> Set[str]:
    # 1. If env var is defined and is not empty, always use it
    if env.agenta.blocked_domains:
        return env.agenta.blocked_domains

    # 2. Else, try PostHog feature flags if enabled
    if env.posthog.enabled:
        feature_flag = "blocked-domains"
        cache_key = {
            "ff": feature_flag,
        }

        # Try cache first
        flag_blocked_domains: Optional[Set[str]] = await get_cache(
            namespace="posthog:flags",
            key=cache_key,
            retry=False,
        )

        if flag_blocked_domains is not None:
            return set(flag_blocked_domains)

        # Fetch from PostHog if not cached
        flag_blocked_domains = posthog.get_feature_flag(
            feature_flag,
            "user distinct id",
        )

        # Normalize to set
        blocked_set = list(
            {e.strip().lower() for e in flag_blocked_domains}
            if isinstance(flag_blocked_domains, (list, set, tuple))
            else set()
        )

        # Cache the result
        await set_cache(
            namespace="posthog:flags",
            key=cache_key,
            value=blocked_set,
        )

        return set(blocked_set)

    # 3. Else, return empty set
    return set()


async def _get_blocked_emails() -> Set[str]:
    # 1. If env var is defined and is not empty, always use it
    if env.agenta.blocked_emails:
        return env.agenta.blocked_emails

    # 2. Else, try PostHog feature flags if enabled
    if env.posthog.enabled:
        feature_flag = "blocked-emails"
        cache_key = {
            "ff": feature_flag,
        }

        # Try cache first
        flag_blocked_emails: Optional[Set[str]] = await get_cache(
            namespace="posthog:flags",
            key=cache_key,
            retry=False,
        )

        if flag_blocked_emails is not None:
            return set(flag_blocked_emails)

        # Fetch from PostHog if not cached
        flag_blocked_emails = posthog.get_feature_flag(
            feature_flag,
            "user distinct id",
        )

        # Normalize to set
        blocked_set = list(
            {e.strip().lower() for e in flag_blocked_emails}
            if isinstance(flag_blocked_emails, (list, set, tuple))
            else set()
        )

        # Cache the result
        await set_cache(
            namespace="posthog:flags",
            key=cache_key,
            value=blocked_set,
        )

        return set(blocked_set)

    # 3. Else, return empty set
    return set()


async def _is_blocked(email: str) -> bool:
    email = email.lower()
    domain = email.split("@")[-1] if "@" in email else ""
    allowed_domains = env.agenta.allowed_domains
    is_domain_allowed = allowed_domains and domain in allowed_domains

    if allowed_domains and not is_domain_allowed:
        return True

    if email and email in await _get_blocked_emails():
        return True

    if domain and domain in await _get_blocked_domains() and not is_domain_allowed:
        return True

    return False


async def _create_account(email: str, uid: str) -> bool:
    """
    Create the internal user and related entities if missing.

    This is idempotent: if a user already exists, it returns early.

    Returns:
        True if a new user was created, False if user already existed.
    """
    log.info("[AUTH] _create_account start", email=email, uid=uid)
    # Check if user already exists (idempotent - skip if adding new auth method)
    existing_user = await get_user_with_email(email=email)
    if existing_user is not None:
        log.info("[AUTH] _create_account skip existing user", email=email, uid=uid)
        return False

    # Check email blocking (EE only)
    if is_ee() and await _is_blocked(email):
        raise UnauthorizedException(detail="This email is not allowed.")

    payload = {
        "uid": uid,
        "email": email,
    }

    # For EE: organization is created inside create_accounts
    # For OSS: we need to handle first user specially to avoid FK violation
    if is_ee():
        await create_accounts(payload)
    else:
        # OSS: Check if this is the first user signup
        first_user = await is_first_user_signup()

        if first_user:
            # First user: Create user first, then organization
            # This avoids the FK violation where org.owner_id references non-existent user
            user_db = await create_accounts(payload)

            # Now create organization with the real user ID
            organization_db = await setup_oss_organization_for_first_user(
                user_id=user_db.id,
                user_email=email,
            )

            # Assign user to organization
            from oss.src.services.db_manager import _assign_user_to_organization_oss

            await _assign_user_to_organization_oss(
                user_db=user_db,
                organization_id=str(organization_db.id),
                email=email,
            )
        else:
            # Not first user: Get existing organization and check invitation
            organization_db = await get_oss_organization()
            if not organization_db:
                raise UnauthorizedException(
                    detail="No organization found. Please contact the administrator."
                )

            # Verify user can join (invitation check)
            user_invitation_exists = await check_if_user_invitation_exists(
                email=email,
                organization_id=str(organization_db.id),
            )
            if not user_invitation_exists:
                raise UnauthorizedException(
                    detail="You need to be invited by the organization owner to gain access."
                )

            payload["organization_id"] = str(organization_db.id)
            await create_accounts(payload)

    if env.posthog.enabled and env.posthog.api_key:
        try:
            posthog.capture(
                distinct_id=email,
                event="user_signed_up_v1",
                properties={
                    "source": "auth",
                    "is_ee": is_ee(),
                    "cloud_region": _get_signup_cloud_region(_get_signup_cloud_url()),
                    "cloud_url": _get_signup_cloud_url(),
                },
            )
        except Exception:
            log.error("[AUTH] Failed to capture PostHog signup event", exc_info=True)
    log.info("[AUTH] _create_account done", email=email, uid=uid)
    return True


async def _create_identity_if_user_exists(
    email: str,
    method: str,
    subject: str,
    domain: Optional[str],
) -> Optional[Any]:
    internal_user = await get_user_with_email(email)
    if not internal_user:
        return None

    existing = await identities_dao.get_by_method_subject(
        method=method,
        subject=subject,
    )

    if not existing:
        await identities_dao.create(
            UserIdentityCreate(
                user_id=internal_user.id,
                method=method,
                subject=subject,
                domain=domain,
            )
        )

    return internal_user


async def _get_identities_for_user(
    internal_user: Optional[Any],
    fallback_method: str,
) -> List[str]:
    if internal_user:
        all_identities = await identities_dao.list_by_user(internal_user.id)
        return [identity.method for identity in all_identities]
    return [fallback_method]


async def _get_dynamic_oidc_provider(third_party_id: str) -> Optional[ProviderInput]:
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


def override_emailpassword_apis(
    original: EmailPasswordAPIInterface,
):
    og_sign_up_post = original.sign_up_post
    og_sign_in_post = original.sign_in_post

    async def sign_in_post(
        form_fields: List[FormField],
        tenant_id: str,
        session: Union[SessionContainer, None],
        should_try_linking_with_session_user: Union[bool, None],
        api_options: EmailPasswordAPIOptions,
        user_context: Dict[str, Any],
    ):
        if form_fields[0].id == "email" and is_input_email(form_fields[0].value):
            email = form_fields[0].value.lower()
            if is_ee() and await _is_blocked(email):
                raise UnauthorizedException(detail="This email is not allowed.")
            user_id = await get_user_with_email(email)
            if user_id is not None:
                supertokens_user = await get_user_from_supertokens(user_id)
                if supertokens_user is not None:
                    login_method = next(
                        (
                            lm
                            for lm in supertokens_user.login_methods
                            if lm.recipe_user_id.get_as_string() == user_id
                            and lm.recipe_id == "emailpassword"
                        ),
                        None,
                    )
                    if login_method is not None:
                        assert login_method.email is not None

        return await og_sign_in_post(
            form_fields,
            tenant_id,
            session,
            should_try_linking_with_session_user,
            api_options,
            user_context,
        )

    async def sign_up_post(
        form_fields: List[FormField],
        tenant_id: str,
        session: Union[SessionContainer, None],
        should_try_linking_with_session_user: Union[bool, None],
        api_options: EmailPasswordAPIOptions,
        user_context: Dict[str, Any],
    ):
        # FLOW 1: Sign in (redirect existing users with emailpassword credential)
        email = form_fields[0].value.lower()
        if is_ee() and await _is_blocked(email):
            raise UnauthorizedException(detail="This email is not allowed.")
        user_info_from_st = await list_users_by_account_info(
            tenant_id="public", account_info=AccountInfo(email=email)
        )

        # Check if user has an emailpassword login method
        has_emailpassword_method = False
        for user in user_info_from_st:
            for lm in user.login_methods:
                if lm.recipe_id == "emailpassword":
                    has_emailpassword_method = True
                    break
            if has_emailpassword_method:
                break

        # Only redirect to sign_in if user has emailpassword credential
        # This allows users who signed up via OAuth to add email/password
        if has_emailpassword_method:
            return await sign_in_post(
                form_fields,
                tenant_id,
                session,
                should_try_linking_with_session_user,
                api_options,
                user_context,
            )

        # FLOW 2: Create SuperTokens user
        response = await og_sign_up_post(
            form_fields,
            tenant_id,
            session,
            should_try_linking_with_session_user,
            api_options,
            user_context,
        )

        return response

    original.sign_up_post = sign_up_post  # type: ignore
    original.sign_in_post = sign_in_post  # type: ignore
    return original


def override_passwordless_apis(
    original_implementation: PasswordlessRecipeInterface,
):
    original_consume_code_post = original_implementation.consume_code_post

    async def consume_code_post(
        pre_auth_session_id: str,
        user_input_code: Union[str, None],
        device_id: Union[str, None],
        link_code: Union[str, None],
        session: Optional[SessionContainer] = None,
        should_try_linking_with_session_user: Optional[bool] = None,
        tenant_id: str = "public",
        api_options: Optional[APIOptions] = None,
        user_context: Optional[Dict[str, Any]] = None,
    ):
        # First we call the original implementation of consume_code_post.
        response = await original_consume_code_post(
            pre_auth_session_id,
            user_input_code,
            device_id,
            link_code,
            session,
            should_try_linking_with_session_user,
            tenant_id,
            api_options,
            user_context or {},
        )

        return response

    original_implementation.consume_code_post = consume_code_post  # type: ignore
    return original_implementation


def override_thirdparty_apis(
    original_implementation: ThirdPartyAPIInterface,
):
    original_sign_in_up = original_implementation.sign_in_up_post

    async def thirdparty_sign_in_up_post(
        provider: Provider,
        tenant_id: str,
        api_options: APIOptions,
        user_context: Dict[str, Any],
        redirect_uri_info: Optional[RedirectUriInfo] = None,
        oauth_tokens: Optional[Dict[str, Any]] = None,
        session: Optional[SessionContainer] = None,
        should_try_linking_with_session_user: Optional[bool] = None,
    ):
        # Call the original implementation if needed
        response = await original_sign_in_up(
            provider,
            redirect_uri_info,
            oauth_tokens,
            session,
            should_try_linking_with_session_user,
            tenant_id,
            api_options,
            user_context,
        )

        return response

    original_implementation.sign_in_up_post = thirdparty_sign_in_up_post  # type: ignore

    return original_implementation


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

        # Create internal user account first (idempotent - skips if exists)
        normalized_email = email.lower()
        is_new_user = await _create_account(normalized_email, result.user.id)
        user_context["is_new_user"] = is_new_user

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            internal_user = await _create_identity_if_user_exists(
                email=normalized_email,
                method=method,
                subject=third_party_user_id,
                domain=domain,
            )
        except Exception:
            # Log error but don't block authentication
            log.info("[AUTH] Identity not created", exc_info=True)

        # Fetch all user identities for session payload
        try:
            identities_array = await _get_identities_for_user(internal_user, method)
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

        provider_input = await _get_dynamic_oidc_provider(third_party_id)
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


def override_passwordless_functions(
    original_implementation: PasswordlessRecipeInterface,
) -> PasswordlessRecipeInterface:
    """Override passwordless recipe functions to track email:otp identity."""

    original_create_code = original_implementation.create_code
    original_consume_code = original_implementation.consume_code

    async def create_code(
        email: Optional[str],
        phone_number: Optional[str],
        user_input_code: Optional[str],
        tenant_id: str,
        user_context: Dict[str, Any],
        **kwargs: Any,
    ):
        normalized_email = email.lower() if email else None
        if normalized_email and is_ee() and await _is_blocked(normalized_email):
            raise UnauthorizedException(detail="This email is not allowed.")

        return await original_create_code(
            email=email,
            phone_number=phone_number,
            user_input_code=user_input_code,
            tenant_id=tenant_id,
            user_context=user_context,
            **kwargs,
        )

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

        normalized_email = email.lower()
        if is_ee() and await _is_blocked(normalized_email):
            raise UnauthorizedException(detail="This email is not allowed.")

        # Create internal user account first (idempotent - skips if exists)
        is_new_user = await _create_account(normalized_email, user_id_str)
        user_context["is_new_user"] = is_new_user

        # Extract domain from email
        domain = (
            normalized_email.split("@")[1]
            if "@" in normalized_email and normalized_email.count("@") == 1
            else None
        )

        # Create or update user_identity
        try:
            internal_user = await _create_identity_if_user_exists(
                email=normalized_email,
                method=method,
                subject=normalized_email,
                domain=domain,
            )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            identities_array = await _get_identities_for_user(internal_user, method)
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
                    email=normalized_email,
                    user_id=internal_user.id,
                )
            except Exception:
                log.error("[AUTH] Error enforcing domain policies", exc_info=True)

        return result

    original_implementation.create_code = create_code
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

        # Check if internal user exists (sign_in can be called for new users too)
        normalized_email = email.lower()
        existing_user = await get_user_with_email(normalized_email)

        # If no internal user, create one (this can happen when ST user exists but internal doesn't)
        if not existing_user:
            is_new_user = await _create_account(normalized_email, result.user.id)
            user_context["is_new_user"] = is_new_user
        else:
            user_context["is_new_user"] = False

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            internal_user = await _create_identity_if_user_exists(
                email=normalized_email,
                method=method,
                subject=normalized_email,
                domain=domain,
            )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            identities_array = await _get_identities_for_user(internal_user, method)
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

        # Create internal user account first (idempotent - skips if exists)
        normalized_email = email.lower()
        is_new_user = await _create_account(normalized_email, result.user.id)
        user_context["is_new_user"] = is_new_user

        # Extract domain from email
        domain = email.split("@")[1] if "@" in email and email.count("@") == 1 else None

        # Create or update user_identity
        try:
            internal_user = await _create_identity_if_user_exists(
                email=normalized_email,
                method=method,
                subject=normalized_email,
                domain=domain,
            )
        except Exception:
            # Log error but don't block authentication
            pass

        # Fetch all user identities for session payload
        try:
            identities_array = await _get_identities_for_user(internal_user, method)
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
        is_new_user = user_context.get("is_new_user", False)

        # Merge with existing payload
        if access_token_payload is None:
            access_token_payload = {}

        access_token_payload["user_identities"] = user_identities
        access_token_payload["session_identities"] = session_identities
        access_token_payload["is_new_user"] = is_new_user

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
