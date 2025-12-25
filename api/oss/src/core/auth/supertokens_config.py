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

    return InputAppInfo(
        app_name="Agenta",
        api_domain=api_domain,
        website_domain=env.agenta.web_url,
        api_gateway_path=api_gateway_path,
        api_base_path="/auth",
        website_base_path="/auth",
    )


def get_thirdparty_providers() -> List[ProviderInput]:
    """
    Get third-party OAuth providers configuration.

    This includes:
    - Social providers (Google, GitHub, etc.)
    - Dynamic OIDC providers will be added at runtime via override callbacks
    """
    providers = []

    # Google OAuth
    if env.auth.google_enabled:
        assert env.auth.google_oauth_client_id is not None
        assert env.auth.google_oauth_client_secret is not None
        providers.append(
            ProviderInput(
                config=ProviderConfig(
                    third_party_id="google",
                    clients=[
                        ProviderClientConfig(
                            client_id=env.auth.google_oauth_client_id,
                            client_secret=env.auth.google_oauth_client_secret,
                        ),
                    ],
                )
            )
        )

    # GitHub OAuth
    if env.auth.github_enabled:
        assert env.auth.github_oauth_client_id is not None
        assert env.auth.github_oauth_client_secret is not None
        providers.append(
            ProviderInput(
                config=ProviderConfig(
                    third_party_id="github",
                    clients=[
                        ProviderClientConfig(
                            client_id=env.auth.github_oauth_client_id,
                            client_secret=env.auth.github_oauth_client_secret,
                        ),
                    ],
                )
            )
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
