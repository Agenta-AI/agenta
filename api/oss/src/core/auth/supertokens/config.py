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
    validate_password,
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

    app_info = InputAppInfo(
        app_name="Agenta",
        api_domain=api_domain,
        website_domain=env.agenta.web_url,
        api_gateway_path=env.agenta.api_url,
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
    if env.identity.google.enabled:
        assert env.identity.google.client_id is not None
        assert env.identity.google.client_secret is not None
        add_provider(
            provider_id="google",
            client_id=env.identity.google.client_id,
            client_secret=env.identity.google.client_secret,
        )

    # Google Workspaces OAuth
    if env.identity.google_workspaces.enabled:
        assert env.identity.google_workspaces.client_id is not None
        assert env.identity.google_workspaces.client_secret is not None
        add_provider(
            provider_id="google-workspaces",
            client_id=env.identity.google_workspaces.client_id,
            client_secret=env.identity.google_workspaces.client_secret,
            additional_config={
                "hd": env.identity.google_workspaces.hd,
            }
            if env.identity.google_workspaces.hd
            else None,
        )

    # GitHub OAuth
    if env.identity.github.enabled:
        assert env.identity.github.client_id is not None
        assert env.identity.github.client_secret is not None
        add_provider(
            provider_id="github",
            client_id=env.identity.github.client_id,
            client_secret=env.identity.github.client_secret,
            additional_config={"scope": ["user:email"]},
        )

    # Facebook OAuth
    if env.identity.facebook.enabled:
        assert env.identity.facebook.client_id is not None
        assert env.identity.facebook.client_secret is not None
        add_provider(
            provider_id="facebook",
            client_id=env.identity.facebook.client_id,
            client_secret=env.identity.facebook.client_secret,
        )

    # Apple OAuth
    if env.identity.apple.enabled:
        assert env.identity.apple.client_id is not None
        additional_config = None
        if (
            env.identity.apple.key_id
            and env.identity.apple.team_id
            and env.identity.apple.private_key
        ):
            additional_config = {
                "keyId": env.identity.apple.key_id,
                "teamId": env.identity.apple.team_id,
                "privateKey": env.identity.apple.private_key,
            }
        add_provider(
            provider_id="apple",
            client_id=env.identity.apple.client_id,
            client_secret=env.identity.apple.client_secret,
            additional_config=additional_config,
        )

    # Discord OAuth
    if env.identity.discord.enabled:
        assert env.identity.discord.client_id is not None
        assert env.identity.discord.client_secret is not None
        add_provider(
            provider_id="discord",
            client_id=env.identity.discord.client_id,
            client_secret=env.identity.discord.client_secret,
        )

    # Twitter OAuth
    if env.identity.twitter.enabled:
        assert env.identity.twitter.client_id is not None
        assert env.identity.twitter.client_secret is not None
        add_provider(
            provider_id="twitter",
            client_id=env.identity.twitter.client_id,
            client_secret=env.identity.twitter.client_secret,
        )

    # GitLab OAuth
    if env.identity.gitlab.enabled:
        assert env.identity.gitlab.client_id is not None
        assert env.identity.gitlab.client_secret is not None
        add_provider(
            provider_id="gitlab",
            client_id=env.identity.gitlab.client_id,
            client_secret=env.identity.gitlab.client_secret,
            additional_config={
                "gitlabBaseUrl": env.identity.gitlab.base_url,
            }
            if env.identity.gitlab.base_url
            else None,
        )

    # Bitbucket OAuth
    if env.identity.bitbucket.enabled:
        assert env.identity.bitbucket.client_id is not None
        assert env.identity.bitbucket.client_secret is not None
        add_provider(
            provider_id="bitbucket",
            client_id=env.identity.bitbucket.client_id,
            client_secret=env.identity.bitbucket.client_secret,
        )

    # LinkedIn OAuth
    if env.identity.linkedin.enabled:
        assert env.identity.linkedin.client_id is not None
        assert env.identity.linkedin.client_secret is not None
        add_provider(
            provider_id="linkedin",
            client_id=env.identity.linkedin.client_id,
            client_secret=env.identity.linkedin.client_secret,
        )

    # Okta OAuth
    if env.identity.okta.enabled:
        assert env.identity.okta.client_id is not None
        assert env.identity.okta.client_secret is not None
        assert env.identity.okta.domain is not None
        add_provider(
            provider_id="okta",
            client_id=env.identity.okta.client_id,
            client_secret=env.identity.okta.client_secret,
            additional_config={
                "oktaDomain": env.identity.okta.domain,
            },
        )

    # Azure AD OAuth
    if env.identity.azure_ad.enabled:
        assert env.identity.azure_ad.client_id is not None
        assert env.identity.azure_ad.client_secret is not None
        assert env.identity.azure_ad.directory_id is not None
        add_provider(
            provider_id="azure-ad",
            client_id=env.identity.azure_ad.client_id,
            client_secret=env.identity.azure_ad.client_secret,
            additional_config={
                "directoryId": env.identity.azure_ad.directory_id,
            },
        )

    # BoxySAML OAuth
    if env.identity.boxy_saml.enabled:
        assert env.identity.boxy_saml.client_id is not None
        assert env.identity.boxy_saml.client_secret is not None
        assert env.identity.boxy_saml.url is not None
        add_provider(
            provider_id="boxy-saml",
            client_id=env.identity.boxy_saml.client_id,
            client_secret=env.identity.boxy_saml.client_secret,
            additional_config={
                "boxyURL": env.identity.boxy_saml.url,
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
                        InputFormField(id="password", validate=validate_password),
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
