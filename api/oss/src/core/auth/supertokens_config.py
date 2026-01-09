"""SuperTokens configuration and initialization."""

from typing import Dict, List, Any, Optional
from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import (
    passwordless,
    session,
    dashboard,
    thirdparty,
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
from oss.src.core.auth.supertokens_overrides import (
    override_thirdparty_functions,
    override_thirdparty_apis,
    override_passwordless_functions,
    override_session_functions,
)


def get_supertokens_config() -> Dict[str, Any]:
    """Get SuperTokens configuration from environment."""
    return {
        "connection_uri": env.supertokens.uri_core,
        "api_key": env.supertokens.api_key,
    }


def get_app_info() -> InputAppInfo:
    """Get SuperTokens app info."""
    # Extract domain from full URL (e.g., "http://localhost/api" -> "http://localhost")
    from urllib.parse import urlparse

    api_parsed = urlparse(env.agenta.api_url)
    api_domain = f"{api_parsed.scheme}://{api_parsed.netloc}"
    api_gateway_path = api_parsed.path or "/"
    # Avoid double /api when app is already mounted under root_path="/api".
    if api_gateway_path == "/api":
        api_gateway_path = "/"

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
    """Initialize SuperTokens with recipes and dynamic provider support."""

    init(
        supertokens_config=SupertokensConfig(**get_supertokens_config()),
        app_info=get_app_info(),
        framework="fastapi",
        recipe_list=[
            # Email OTP (passwordless)
            passwordless.init(
                contact_config=ContactEmailOnlyConfig(),
                flow_type="USER_INPUT_CODE_AND_MAGIC_LINK",
                override=PasswordlessInputOverrideConfig(
                    functions=override_passwordless_functions,
                ),
            ),
            # Third-party OAuth (social + dynamic OIDC)
            thirdparty.init(
                sign_in_and_up_feature=thirdparty.SignInAndUpFeature(
                    providers=get_thirdparty_providers()
                ),
                override=ThirdPartyInputOverrideConfig(
                    functions=override_thirdparty_functions,
                    apis=override_thirdparty_apis,
                ),
            ),
            # Session management with custom identities payload
            session.init(
                get_token_transfer_method=lambda _, __, ___: "cookie",
                override=SessionInputOverrideConfig(
                    functions=override_session_functions,
                ),
            ),
            # SuperTokens dashboard
            dashboard.init(),
        ],
        mode="asgi",
    )
