from typing import Dict, List, Any
from urllib.parse import urlparse

from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import (
    emailpassword,
    passwordless,
    session,
    thirdparty,
)
from supertokens_python.recipe.emailpassword.utils import (
    InputSignUpFeature,
    InputOverrideConfig as EmailPasswordInputOverrideConfig,
)
from supertokens_python.recipe.emailpassword.types import (
    InputFormField,
)
from supertokens_python.recipe.passwordless import (
    ContactEmailOnlyConfig,
    InputOverrideConfig as PasswordlessInputOverrideConfig,
)
from supertokens_python.recipe.thirdparty import (
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
    InputOverrideConfig as ThirdPartyInputOverrideConfig,
)
from supertokens_python.recipe.session import (
    InputOverrideConfig as SessionInputOverrideConfig,
)

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.validators import (
    validate_user_email_or_username,
    validate_actual_email,
)
from oss.src.core.auth.supertokens.overrides import (
    override_emailpassword_apis,
    override_emailpassword_functions,
    override_thirdparty_functions,
    override_thirdparty_apis,
    override_passwordless_functions,
    override_passwordless_apis,
    override_session_functions,
)

log = get_module_logger(__name__)


def get_supertokens_config() -> Dict[str, Any]:
    """Get SuperTokens configuration from environment."""
    return {
        "connection_uri": env.supertokens.uri_core,
        "api_key": env.supertokens.api_key,
    }


def get_app_info() -> InputAppInfo:
    """Get SuperTokens app info."""
    # Extract domain from full URL (e.g., "http://localhost/api" -> "http://localhost")
    api_parsed = urlparse(env.agenta.api_url)
    api_domain = f"{api_parsed.scheme}://{api_parsed.netloc}"
    api_gateway_path = api_parsed.path or "/"
    # NOTE: We keep api_gateway_path as-is (e.g., "/api") so that SuperTokens
    # sets cookie paths correctly from the browser's perspective.
    # The browser makes requests to /api/auth/*, so cookies must be set
    # with paths that match /api/auth/* (not just /auth/*).

    app_info = InputAppInfo(
        app_name="Agenta",
        api_domain=api_domain,
        website_domain=env.agenta.web_url,
        api_gateway_path=api_gateway_path,
        api_base_path="/auth",
        website_base_path="/auth",
    )
    return app_info


def get_thirdparty_providers() -> List[ProviderInput]:
    """
    Get third-party OAuth providers configuration.

    This includes:
    - Social providers (Google, GitHub, etc.)
    - Dynamic OIDC providers will be added at runtime via override callbacks
    """
    providers = []

    def add_provider(
        *,
        provider_id: str,
        client_id: str,
        client_secret: str | None,
        additional_config: Dict[str, Any] | None = None,
    ) -> None:
        providers.append(
            ProviderInput(
                config=ProviderConfig(
                    third_party_id=provider_id,
                    clients=[
                        ProviderClientConfig(
                            client_id=client_id,
                            client_secret=client_secret,
                            additional_config=additional_config,
                        ),
                    ],
                )
            )
        )

    # Google OAuth
    if env.auth.google_enabled:
        assert env.auth.google_oauth_client_id is not None
        assert env.auth.google_oauth_client_secret is not None
        add_provider(
            provider_id="google",
            client_id=env.auth.google_oauth_client_id,
            client_secret=env.auth.google_oauth_client_secret,
        )

    # Google Workspaces OAuth
    if env.auth.google_workspaces_enabled:
        assert env.auth.google_workspaces_oauth_client_id is not None
        assert env.auth.google_workspaces_oauth_client_secret is not None
        add_provider(
            provider_id="google-workspaces",
            client_id=env.auth.google_workspaces_oauth_client_id,
            client_secret=env.auth.google_workspaces_oauth_client_secret,
            additional_config={
                "hd": env.auth.google_workspaces_hd,
            }
            if env.auth.google_workspaces_hd
            else None,
        )

    # GitHub OAuth
    if env.auth.github_enabled:
        assert env.auth.github_oauth_client_id is not None
        assert env.auth.github_oauth_client_secret is not None
        add_provider(
            provider_id="github",
            client_id=env.auth.github_oauth_client_id,
            client_secret=env.auth.github_oauth_client_secret,
            additional_config={"scope": ["user:email"]},
        )

    # Facebook OAuth
    if env.auth.facebook_enabled:
        assert env.auth.facebook_oauth_client_id is not None
        assert env.auth.facebook_oauth_client_secret is not None
        add_provider(
            provider_id="facebook",
            client_id=env.auth.facebook_oauth_client_id,
            client_secret=env.auth.facebook_oauth_client_secret,
        )

    # Apple OAuth
    if env.auth.apple_enabled:
        assert env.auth.apple_oauth_client_id is not None
        additional_config = None
        if (
            env.auth.apple_key_id
            and env.auth.apple_team_id
            and env.auth.apple_private_key
        ):
            additional_config = {
                "keyId": env.auth.apple_key_id,
                "teamId": env.auth.apple_team_id,
                "privateKey": env.auth.apple_private_key,
            }
        add_provider(
            provider_id="apple",
            client_id=env.auth.apple_oauth_client_id,
            client_secret=env.auth.apple_oauth_client_secret,
            additional_config=additional_config,
        )

    # Discord OAuth
    if env.auth.discord_enabled:
        assert env.auth.discord_oauth_client_id is not None
        assert env.auth.discord_oauth_client_secret is not None
        add_provider(
            provider_id="discord",
            client_id=env.auth.discord_oauth_client_id,
            client_secret=env.auth.discord_oauth_client_secret,
        )

    # Twitter OAuth
    if env.auth.twitter_enabled:
        assert env.auth.twitter_oauth_client_id is not None
        assert env.auth.twitter_oauth_client_secret is not None
        add_provider(
            provider_id="twitter",
            client_id=env.auth.twitter_oauth_client_id,
            client_secret=env.auth.twitter_oauth_client_secret,
        )

    # GitLab OAuth
    if env.auth.gitlab_enabled:
        assert env.auth.gitlab_oauth_client_id is not None
        assert env.auth.gitlab_oauth_client_secret is not None
        add_provider(
            provider_id="gitlab",
            client_id=env.auth.gitlab_oauth_client_id,
            client_secret=env.auth.gitlab_oauth_client_secret,
            additional_config={
                "gitlabBaseUrl": env.auth.gitlab_base_url,
            }
            if env.auth.gitlab_base_url
            else None,
        )

    # Bitbucket OAuth
    if env.auth.bitbucket_enabled:
        assert env.auth.bitbucket_oauth_client_id is not None
        assert env.auth.bitbucket_oauth_client_secret is not None
        add_provider(
            provider_id="bitbucket",
            client_id=env.auth.bitbucket_oauth_client_id,
            client_secret=env.auth.bitbucket_oauth_client_secret,
        )

    # LinkedIn OAuth
    if env.auth.linkedin_enabled:
        assert env.auth.linkedin_oauth_client_id is not None
        assert env.auth.linkedin_oauth_client_secret is not None
        add_provider(
            provider_id="linkedin",
            client_id=env.auth.linkedin_oauth_client_id,
            client_secret=env.auth.linkedin_oauth_client_secret,
        )

    # Okta OAuth
    if env.auth.okta_enabled:
        assert env.auth.okta_oauth_client_id is not None
        assert env.auth.okta_oauth_client_secret is not None
        assert env.auth.okta_domain is not None
        add_provider(
            provider_id="okta",
            client_id=env.auth.okta_oauth_client_id,
            client_secret=env.auth.okta_oauth_client_secret,
            additional_config={
                "oktaDomain": env.auth.okta_domain,
            },
        )

    # Azure AD OAuth
    if env.auth.azure_ad_enabled:
        assert env.auth.azure_ad_oauth_client_id is not None
        assert env.auth.azure_ad_oauth_client_secret is not None
        assert env.auth.azure_ad_directory_id is not None
        add_provider(
            provider_id="azure-ad",
            client_id=env.auth.azure_ad_oauth_client_id,
            client_secret=env.auth.azure_ad_oauth_client_secret,
            additional_config={
                "directoryId": env.auth.azure_ad_directory_id,
            },
        )

    # BoxySAML OAuth
    if env.auth.boxy_saml_enabled:
        assert env.auth.boxy_saml_oauth_client_id is not None
        assert env.auth.boxy_saml_oauth_client_secret is not None
        assert env.auth.boxy_saml_url is not None
        add_provider(
            provider_id="boxy-saml",
            client_id=env.auth.boxy_saml_oauth_client_id,
            client_secret=env.auth.boxy_saml_oauth_client_secret,
            additional_config={
                "boxyURL": env.auth.boxy_saml_url,
            },
        )

    return providers


def init_supertokens():
    """Initialize SuperTokens with only enabled recipes."""
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
                override=EmailPasswordInputOverrideConfig(
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
                override=PasswordlessInputOverrideConfig(
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

    # Initialize thirdparty recipe if we have static providers OR if EE is enabled
    if oidc_providers or is_ee():
        recipe_list.append(
            thirdparty.init(
                sign_in_and_up_feature=thirdparty.SignInAndUpFeature(
                    providers=oidc_providers
                ),
                override=ThirdPartyInputOverrideConfig(
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
            override=SessionInputOverrideConfig(
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
