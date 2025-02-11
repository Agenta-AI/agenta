import os
from typing import Optional, Any, Dict, Union

import sentry_sdk
from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe.thirdparty import (
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
    SignInAndUpFeature,
)
from supertokens_python.recipe import (
    passwordless,
    session,
    dashboard,
    thirdparty,
)
from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
from supertokens_python.recipe.thirdparty.provider import Provider, RedirectUriInfo
from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.thirdparty.interfaces import APIOptions
from supertokens_python.recipe.passwordless.interfaces import (
    RecipeInterface as PasswordlessRecipeInterface,
    ConsumeCodeOkResult,
)
from supertokens_python.recipe.thirdparty.interfaces import (
    APIInterface as ThirdPartyAPIInterface,
    SignInUpPostOkResult,
)

from agenta_backend.utils.common import isCloudEE

if isCloudEE():
    from agenta_backend.commons.services.commoners import create_accounts
else:
    from agenta_backend.services.db_manager import create_accounts


if os.environ.get("FEATURE_FLAG") in ["ee"]:
    import agenta_backend.ee.__init__


# MODE DSN to env vars
sentry_sdk.init(
    dsn=os.getenv("SENTRY_SDK", None),
    # Set traces_sample_rate to 1.0 to capture 100%
    # of transactions for performance monitoring.
    traces_sample_rate=1.0,
    # Set profiles_sample_rate to 1.0 to profile 100%
    # of sampled transactions.
    # We recommend adjusting this value in production.
    profiles_sample_rate=1.0,
)


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
            payload = {
                "uid": response.user.id,
                "email": response.user.emails[0],
            }
            await create_accounts(payload)

        return response

    original_implementation.consume_code = consume_code_post
    return original_implementation


def override_thirdparty_apis(original_implementation: ThirdPartyAPIInterface):
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

        # Post sign up response, we check if it was successful
        if isinstance(response, SignInUpPostOkResult):
            payload = {
                "uid": response.user.id,
                "email": response.user.emails[0],
            }
            await create_accounts(payload)

        return response

    original_implementation.sign_in_up_post = thirdparty_sign_in_up_post

    return original_implementation


init(
    # debug=True,
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain=os.environ["DOMAIN_NAME"],
        website_domain=(
            os.environ.get("WEBSITE_DOMAIN_NAME", os.environ["DOMAIN_NAME"])
        ),
        # the fact that both are localhost is causing problems with
        # displaying the dashboard to manage users
        api_gateway_path="/api/",
        api_base_path="/auth/",
        website_base_path="/auth",
    ),
    supertokens_config=SupertokensConfig(
        connection_uri=os.environ["SUPERTOKENS_CONNECTION_URI"],
        api_key=os.environ["SUPERTOKENS_API_KEY"],
    ),
    framework="fastapi",
    recipe_list=[
        thirdparty.init(
            sign_in_and_up_feature=SignInAndUpFeature(
                providers=[
                    ProviderInput(
                        config=ProviderConfig(
                            third_party_id="google",
                            clients=[
                                ProviderClientConfig(
                                    client_id=os.environ["GOOGLE_OAUTH_CLIENT_ID"],
                                    client_secret=os.environ[
                                        "GOOGLE_OAUTH_CLIENT_SECRET"
                                    ],
                                ),
                            ],
                        ),
                    ),
                    ProviderInput(
                        config=ProviderConfig(
                            third_party_id="github",
                            clients=[
                                ProviderClientConfig(
                                    client_id=os.environ["GITHUB_OAUTH_CLIENT_ID"],
                                    client_secret=os.environ[
                                        "GITHUB_OAUTH_CLIENT_SECRET"
                                    ],
                                )
                            ],
                        ),
                    ),
                ],
            ),
            override=thirdparty.InputOverrideConfig(apis=override_thirdparty_apis),
        ),
        passwordless.init(
            flow_type="USER_INPUT_CODE",
            contact_config=ContactEmailOnlyConfig(),
            override=passwordless.InputOverrideConfig(
                functions=override_passwordless_apis
            ),
        ),
        session.init(expose_access_token_to_frontend_in_cookie_based_auth=True),
        dashboard.init(),
    ],
    mode="asgi",
)
