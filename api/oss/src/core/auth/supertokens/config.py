from typing import Any, Dict, List
from urllib.parse import urlparse

from supertokens_python import InputAppInfo, SupertokensConfig, init
from supertokens_python.ingredients.emaildelivery.types import EmailDeliveryConfig
from supertokens_python.recipe import (
    emailpassword,
    passwordless,
    session,
    thirdparty,
)
from supertokens_python.recipe.emailpassword.types import InputFormField
from supertokens_python.recipe.emailpassword.utils import (
    InputOverrideConfig as EmailPasswordInputOverrideConfig,
    InputSignUpFeature,
)
from supertokens_python.recipe.passwordless import (
    ContactEmailOnlyConfig,
    InputOverrideConfig as PasswordlessInputOverrideConfig,
)
from supertokens_python.recipe.passwordless.types import (
    PasswordlessLoginEmailTemplateVars,
)
from supertokens_python.recipe.session import (
    InputOverrideConfig as SessionInputOverrideConfig,
)
from supertokens_python.recipe.thirdparty import (
    InputOverrideConfig as ThirdPartyInputOverrideConfig,
    ProviderClientConfig,
    ProviderConfig,
    ProviderInput,
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


# ---------------------------------------------------------------------------
# Passwordless OTP email delivery — delegates to the shared email service so
# that SMTP_USE_TLS / SendGrid behaviour is identical for OTP and app emails.
# ---------------------------------------------------------------------------


class PasswordlessEmailService:
    """Custom SuperTokens email delivery for passwordless OTP emails.

    Implements ``EmailDeliveryInterface[PasswordlessLoginEmailTemplateVars]``
    by delegating to the shared ``email_service`` so TLS/SSL settings are
    honoured consistently.
    """

    async def send_email(
        self,
        template_vars: PasswordlessLoginEmailTemplateVars,
        user_context: Dict[str, Any],
    ) -> None:
        from oss.src.services import email_service

        otp = template_vars.user_input_code or ""
        code_lifetime = template_vars.code_life_time
        minutes = max(1, code_lifetime // 60)

        html_content = (
            f"<p>Hello,</p>"
            f"<p>Your one-time login code is:</p>"
            f"<h2 style=\"font-family:monospace;letter-spacing:0.15em\">{otp}</h2>"
            f"<p>This code expires in {minutes} minute(s).</p>"
            f"<p>If you did not request this code, you can safely ignore this email.</p>"
            f"<p>Thank you for using Agenta!</p>"
        )

        from_address = env.smtp.from_address or env.sendgrid.from_address
        if not from_address:
            log.warning(
                "Passwordless OTP email skipped — no sender address configured "
                "(set SMTP_FROM_ADDRESS or SENDGRID_FROM_ADDRESS)"
            )
            return

        if not email_service._USE_SMTP and not email_service._USE_SENDGRID:
            log.info(
                "Passwordless OTP email delivery disabled — no email provider configured"
            )
            return

        try:
            if email_service._USE_SMTP:
                email_service._send_via_smtp(
                    to_email=template_vars.email,
                    subject="Your Agenta login code",
                    html_content=html_content,
                    from_email=from_address,
                )
            else:
                email_service._send_via_sendgrid(
                    to_email=template_vars.email,
                    subject="Your Agenta login code",
                    html_content=html_content,
                    from_email=from_address,
                )
            log.info("Passwordless OTP email sent to %s", template_vars.email)
        except Exception:
            log.error(
                "Failed to send passwordless OTP email to %s",
                template_vars.email,
                exc_info=True,
            )


def get_passwordless_email_delivery() -> EmailDeliveryConfig | None:
    """Return email delivery config for the passwordless recipe.

    Routes OTP emails through the shared ``email_service`` so that
    ``SMTP_USE_TLS`` and the SendGrid fallback behave identically to
    application emails (invitations, password resets, etc.).

    Returns ``None`` when no email provider is configured — SuperTokens
    will fall back to its default behaviour.
    """
    from oss.src.services import email_service

    if not email_service._USE_SMTP and not email_service._USE_SENDGRID:
        return None

    return EmailDeliveryConfig(service=PasswordlessEmailService())


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
        if env.identity.google.client_id is None:
            raise RuntimeError(
                "google identity provider enabled but client_id is missing"
            )
        if env.identity.google.client_secret is None:
            raise RuntimeError(
                "google identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="google",
            client_id=env.identity.google.client_id,
            client_secret=env.identity.google.client_secret,
        )

    # Google Workspaces OAuth
    if env.identity.google_workspaces.enabled:
        if env.identity.google_workspaces.client_id is None:
            raise RuntimeError(
                "google_workspaces identity provider enabled but client_id is missing"
            )
        if env.identity.google_workspaces.client_secret is None:
            raise RuntimeError(
                "google_workspaces identity provider enabled but client_secret is missing"
            )
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
        if env.identity.github.client_id is None:
            raise RuntimeError(
                "github identity provider enabled but client_id is missing"
            )
        if env.identity.github.client_secret is None:
            raise RuntimeError(
                "github identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="github",
            client_id=env.identity.github.client_id,
            client_secret=env.identity.github.client_secret,
            additional_config={"scope": ["user:email"]},
        )

    # Facebook OAuth
    if env.identity.facebook.enabled:
        if env.identity.facebook.client_id is None:
            raise RuntimeError(
                "facebook identity provider enabled but client_id is missing"
            )
        if env.identity.facebook.client_secret is None:
            raise RuntimeError(
                "facebook identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="facebook",
            client_id=env.identity.facebook.client_id,
            client_secret=env.identity.facebook.client_secret,
        )

    # Apple OAuth
    if env.identity.apple.enabled:
        if env.identity.apple.client_id is None:
            raise RuntimeError(
                "apple identity provider enabled but client_id is missing"
            )
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
        if env.identity.discord.client_id is None:
            raise RuntimeError(
                "discord identity provider enabled but client_id is missing"
            )
        if env.identity.discord.client_secret is None:
            raise RuntimeError(
                "discord identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="discord",
            client_id=env.identity.discord.client_id,
            client_secret=env.identity.discord.client_secret,
        )

    # Twitter OAuth
    if env.identity.twitter.enabled:
        if env.identity.twitter.client_id is None:
            raise RuntimeError(
                "twitter identity provider enabled but client_id is missing"
            )
        if env.identity.twitter.client_secret is None:
            raise RuntimeError(
                "twitter identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="twitter",
            client_id=env.identity.twitter.client_id,
            client_secret=env.identity.twitter.client_secret,
        )

    # GitLab OAuth
    if env.identity.gitlab.enabled:
        if env.identity.gitlab.client_id is None:
            raise RuntimeError(
                "gitlab identity provider enabled but client_id is missing"
            )
        if env.identity.gitlab.client_secret is None:
            raise RuntimeError(
                "gitlab identity provider enabled but client_secret is missing"
            )
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
        if env.identity.bitbucket.client_id is None:
            raise RuntimeError(
                "bitbucket identity provider enabled but client_id is missing"
            )
        if env.identity.bitbucket.client_secret is None:
            raise RuntimeError(
                "bitbucket identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="bitbucket",
            client_id=env.identity.bitbucket.client_id,
            client_secret=env.identity.bitbucket.client_secret,
        )

    # LinkedIn OAuth
    if env.identity.linkedin.enabled:
        if env.identity.linkedin.client_id is None:
            raise RuntimeError(
                "linkedin identity provider enabled but client_id is missing"
            )
        if env.identity.linkedin.client_secret is None:
            raise RuntimeError(
                "linkedin identity provider enabled but client_secret is missing"
            )
        add_provider(
            provider_id="linkedin",
            client_id=env.identity.linkedin.client_id,
            client_secret=env.identity.linkedin.client_secret,
        )

    # Okta OAuth
    if env.identity.okta.enabled:
        if env.identity.okta.client_id is None:
            raise RuntimeError(
                "okta identity provider enabled but client_id is missing"
            )
        if env.identity.okta.client_secret is None:
            raise RuntimeError(
                "okta identity provider enabled but client_secret is missing"
            )
        if env.identity.okta.domain is None:
            raise RuntimeError("okta identity provider enabled but domain is missing")
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
        if env.identity.azure_ad.client_id is None:
            raise RuntimeError(
                "azure_ad identity provider enabled but client_id is missing"
            )
        if env.identity.azure_ad.client_secret is None:
            raise RuntimeError(
                "azure_ad identity provider enabled but client_secret is missing"
            )
        if env.identity.azure_ad.directory_id is None:
            raise RuntimeError(
                "azure_ad identity provider enabled but directory_id is missing"
            )
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
        if env.identity.boxy_saml.client_id is None:
            raise RuntimeError(
                "boxy_saml identity provider enabled but client_id is missing"
            )
        if env.identity.boxy_saml.client_secret is None:
            raise RuntimeError(
                "boxy_saml identity provider enabled but client_secret is missing"
            )
        if env.identity.boxy_saml.url is None:
            raise RuntimeError("boxy_saml identity provider enabled but url is missing")
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
                email_delivery=get_passwordless_email_delivery(),
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
