from typing import Optional, Any, Dict, Union, List, Set
from urllib.parse import urlparse

import posthog

from supertokens_python import (
    SupertokensConfig,
    init,
)
from supertokens_python.asyncio import (
    list_users_by_account_info,
    get_user as get_user_from_supertokens,
)
from supertokens_python.recipe import (
    emailpassword,
    passwordless,
    thirdparty,
    session,
)
from supertokens_python.recipe.emailpassword.interfaces import (
    APIInterface as EmailPasswordAPIInterface,
    APIOptions as EmailPasswordAPIOptions,
    SignUpPostOkResult as EmailPasswordSignUpPostOkResult,
)
from supertokens_python.recipe.emailpassword.utils import (
    InputSignUpFeature,
    InputOverrideConfig,
)
from supertokens_python.recipe.emailpassword.types import (
    FormField,
    InputFormField,
)
from supertokens_python.recipe.passwordless import (
    ContactEmailOnlyConfig,
)
from supertokens_python.recipe.passwordless.interfaces import (
    RecipeInterface as PasswordlessRecipeInterface,
    ConsumeCodeOkResult,
)
from supertokens_python.recipe.thirdparty import (
    SignInAndUpFeature,
)
from supertokens_python.recipe.thirdparty.interfaces import (
    APIInterface as ThirdPartyAPIInterface,
    SignInUpPostOkResult,
    APIOptions,
)
from supertokens_python.recipe.thirdparty.provider import (
    Provider,
    RedirectUriInfo,
)
from supertokens_python.recipe.session import (
    SessionContainer,
)
from supertokens_python.types import (
    AccountInfo,
)
from oss.src.core.auth.supertokens_overrides import (
    override_emailpassword_functions,
)
from oss.src.core.auth.supertokens_overrides import (
    override_passwordless_functions,
)
from oss.src.core.auth.supertokens_overrides import (
    override_thirdparty_functions,
)
from oss.src.core.auth.supertokens_overrides import (
    override_session_functions,
)
from oss.src.core.auth.supertokens_config import (
    get_app_info,
    get_supertokens_config,
    get_thirdparty_providers,
)

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.validators import (
    validate_user_email_or_username,
    validate_actual_email,
    is_input_email,
)

from oss.src.services.exceptions import UnauthorizedException
from oss.src.services.db_manager import (
    get_user_with_email,
    check_if_user_exists_and_create_organization,
    check_if_user_invitation_exists,
)


log = get_module_logger(__name__)


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


if is_ee():
    from ee.src.services.commoners import create_accounts
else:
    from oss.src.services.db_manager import create_accounts


# ============================================================================
# Helper Functions for Auth Method Overrides
# ============================================================================


async def _create_account(email: str, uid: str) -> None:
    """
    Create an application account for a newly authenticated user.

    This is the unified account creation logic used by all auth methods
    (email/password, passwordless, third-party). It handles:
    - Email blocking checks (EE only)
    - Organization assignment (OSS only)
    - Account creation

    This function is idempotent - if user already exists, it returns early.

    Args:
        email: The user's normalized email address
        uid: The SuperTokens user ID

    Raises:
        UnauthorizedException: If email is blocked or user not invited (OSS only)
    """
    # Check if user already exists (idempotent - skip if adding new auth method)
    existing_user = await get_user_with_email(email=email)
    if existing_user is not None:
        return

    # Check email blocking (EE only)
    if is_ee() and await _is_blocked(email):
        raise UnauthorizedException(detail="This email is not allowed.")

    payload = {
        "uid": uid,
        "email": email,
        "name": "Personal",
        "is_personal": True,
    }

    # For OSS: compute organization before calling create_accounts
    # For EE: organization is created inside create_accounts
    if is_ee():
        await create_accounts(payload)
    else:
        # OSS: Compute or get the single organization
        organization_db = await check_if_user_exists_and_create_organization(
            user_email=email
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

        # FLOW 3: Create application user (idempotent - skips if user exists)
        if isinstance(response, EmailPasswordSignUpPostOkResult):
            actual_email = ""
            for field in form_fields:
                if field.id == "email":
                    actual_email = field.value

            if actual_email != "":
                email = (
                    actual_email
                    if "@" in actual_email
                    else f"{actual_email}@localhost.com"
                ).lower()

                await _create_account(email, response.user.id)

        return response

    original.sign_up_post = sign_up_post  # type: ignore
    original.sign_in_post = sign_in_post  # type: ignore
    return original


def override_passwordless_apis(
    original_implementation: PasswordlessRecipeInterface,
):
    original_consume_code_post = original_implementation.consume_code

    async def consume_code_post(
        pre_auth_session_id: str,
        user_input_code: Union[str, None],
        device_id: Union[str, None],
        link_code: Union[str, None],
        tenant_id: str,
        user_context: Dict[str, Any],
        session: Optional[SessionContainer] = None,
        should_try_linking_with_session_user: Optional[bool] = None,
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
            user_context,
        )

        # Post sign up response, we check if it was successful
        if isinstance(response, ConsumeCodeOkResult):
            email = response.user.emails[0].lower()
            await _create_account(email, response.user.id)

        return response

    original_implementation.consume_code = consume_code_post  # type: ignore
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

        if isinstance(response, SignInUpPostOkResult):
            email = response.user.emails[0].lower()
            await _create_account(email, response.user.id)

        return response

    original_implementation.sign_in_up_post = thirdparty_sign_in_up_post  # type: ignore

    return original_implementation


# Parse AGENTA_API_URL to extract domain and path
try:
    parsed_api_url = urlparse(env.agenta.api_url)
    if not parsed_api_url.scheme or not parsed_api_url.netloc:
        raise ValueError("Invalid AGENTA_API_URL: missing scheme or netloc")

    api_domain = f"{parsed_api_url.scheme}://{parsed_api_url.netloc}"
    api_gateway_path = parsed_api_url.path or "/"
except Exception:
    log.error(
        f"[AUTH] Failed to parse AGENTA_API_URL ('{env.agenta.api_url}')",
        exc_info=True,
    )
    api_domain = ""
    api_gateway_path = "/"


def _init_supertokens():
    """Initialize SuperTokens with only enabled recipes"""
    # Validate auth configuration
    try:
        env.auth.validate_config()
    except ValueError:
        log.error("[AUTH]", exc_info=True)
        raise

    # Build recipe list based on enabled auth methods
    recipe_list = []

    # Email Password Authentication
    if env.auth.email_method == "password":
        log.info("✓ Email/Password authentication enabled")
        recipe_list.append(
            emailpassword.init(
                sign_up_feature=InputSignUpFeature(
                    form_fields=[
                        InputFormField(
                            id="email", validate=validate_user_email_or_username
                        ),
                        InputFormField(
                            id="actualEmail",
                            validate=validate_actual_email,
                            optional=True,
                        ),
                    ]
                ),
                override=InputOverrideConfig(
                    apis=override_emailpassword_apis,
                    functions=override_emailpassword_functions,
                ),
            )
        )

    # Email OTP Authentication
    if env.auth.email_method == "otp":
        log.info("✓ Email/OTP authentication enabled")
        recipe_list.append(
            passwordless.init(
                flow_type="USER_INPUT_CODE",
                contact_config=ContactEmailOnlyConfig(),
                override=passwordless.InputOverrideConfig(
                    apis=override_passwordless_apis,
                    functions=override_passwordless_functions,
                ),
            )
        )

    # Third-Party OIDC Authentication
    # Always initialize thirdparty recipe for dynamic OIDC support (EE)
    oidc_providers = get_thirdparty_providers()
    if oidc_providers:
        enabled_providers = [
            provider.config.third_party_id for provider in oidc_providers
        ]
        log.info("✓ OIDC providers enabled: %s", ", ".join(enabled_providers))

    # Initialize thirdparty recipe if we have static providers OR if EE is enabled (for dynamic OIDC)
    if oidc_providers or is_ee():
        recipe_list.append(
            thirdparty.init(
                sign_in_and_up_feature=SignInAndUpFeature(providers=oidc_providers),
                override=thirdparty.InputOverrideConfig(
                    apis=override_thirdparty_apis,
                    functions=override_thirdparty_functions,
                ),
            )
        )
        if is_ee() and not oidc_providers:
            log.info("✓ Third-party recipe enabled for dynamic OIDC (EE)")

    # Sessions always required if auth is enabled
    recipe_list.append(
        session.init(
            expose_access_token_to_frontend_in_cookie_based_auth=True,
            override=session.InputOverrideConfig(
                functions=override_session_functions,
            ),
        )
    )

    # Initialize SuperTokens with selected recipes
    init(
        app_info=get_app_info(),
        supertokens_config=SupertokensConfig(**get_supertokens_config()),
        framework="fastapi",
        recipe_list=recipe_list,
        mode="asgi",
    )


# Initialize SuperTokens
_init_supertokens()
