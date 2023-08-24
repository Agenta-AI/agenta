from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe.thirdparty import (
    ProviderInput,
    ProviderConfig,
    ProviderClientConfig,
)
from supertokens_python.recipe import (
    thirdpartypasswordless,
    session,
    dashboard,
)
from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
from supertokens_python.recipe.passwordless.interfaces import (
    APIOptions as PAPIOptions,
)
from supertokens_python.recipe.thirdpartypasswordless.interfaces import (
    APIInterface as ThirdpartyPasswordlessAPIInterface,
    ConsumeCodePostOkResult,
    ThirdPartySignInUpPostOkResult,
)
from supertokens_python.recipe.thirdparty import interfaces as ThirdPartyInterfaces
from supertokens_python.recipe.thirdparty.provider import Provider, RedirectUriInfo
import os
from typing import Any, Dict, Union
from agenta_backend.services.commoners import create_accounts
from typing import Optional


ThirdPartyAPIOptions = ThirdPartyInterfaces.APIOptions


def override_thirdpartypasswordless_apis(
    original_implementation: ThirdpartyPasswordlessAPIInterface,
):
    original_consume_code_post = original_implementation.consume_code_post
    original_thirdparty_sign_in_up = original_implementation.thirdparty_sign_in_up_post

    async def consume_code_post(
        pre_auth_session_id: str,
        user_input_code: Union[str, None],
        device_id: Union[str, None],
        link_code: Union[str, None],
        tenant_id: str,
        api_options: PAPIOptions,
        user_context: Dict[str, Any],
    ):
        # First we call the original implementation of consume_code_post.
        response = await original_consume_code_post(
            pre_auth_session_id,
            user_input_code,
            device_id,
            link_code,
            tenant_id,
            api_options,
            user_context,
        )

        # Post sign up response, we check if it was successful
        if isinstance(response, ConsumeCodePostOkResult):
            payload = {
                "user_id": response.user.user_id,
                "user_email": response.user.email,
            }
            await create_accounts(payload)

        return response

    async def thirdparty_sign_in_up_post(
        provider: Provider,
        redirect_uri_info: Optional[RedirectUriInfo],
        oauth_tokens: Optional[Dict[str, Any]],
        tenant_id: str,
        api_options: PAPIOptions,
        user_context: Dict[str, Any],
    ) -> ThirdPartySignInUpPostOkResult:
        # First we call the original implementation of consume_code_post.
        response = await original_thirdparty_sign_in_up(
            provider,
            redirect_uri_info,
            oauth_tokens,
            tenant_id,
            api_options,
            user_context,
        )

        if isinstance(response, ThirdPartySignInUpPostOkResult):
            payload = {
                "user_id": response.user.user_id,
                "user_email": response.user.email,
            }
            await create_accounts(payload)

        return response

    original_implementation.consume_code_post = consume_code_post
    original_implementation.thirdparty_sign_in_up_post = thirdparty_sign_in_up_post
    return original_implementation


init(
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain=os.environ["DOMAIN_NAME"],
        website_domain=os.environ["DOMAIN_NAME"],
        # the fact that both are localhost is causing problems with
        # displaying the dashboard to manage users
        api_base_path="/auth/",
        website_base_path="/auth",
    ),
    supertokens_config=SupertokensConfig(
        connection_uri="http://supertokens:3567",
    ),
    framework="fastapi",
    recipe_list=[
        session.init(),
        thirdpartypasswordless.init(
            flow_type="USER_INPUT_CODE",
            contact_config=ContactEmailOnlyConfig(),
            override=thirdpartypasswordless.InputOverrideConfig(
                apis=override_thirdpartypasswordless_apis
            ),
            providers=[
                # We have provided you with development keys which you can use for testing.
                # IMPORTANT: Please replace them with your own OAuth keys for production use.
                ProviderInput(
                    config=ProviderConfig(
                        third_party_id="google",
                        clients=[
                            ProviderClientConfig(
                                client_id="1060725074195-kmeum4crr01uirfl2op9kd5acmi9jutn.apps.googleusercontent.com",
                                client_secret="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",
                            ),
                        ],
                    ),
                ),
                ProviderInput(
                    config=ProviderConfig(
                        third_party_id="github",
                        clients=[
                            ProviderClientConfig(
                                client_id="467101b197249757c71f",
                                client_secret="e97051221f4b6426e8fe8d51486396703012f5bd",
                            )
                        ],
                    ),
                ),
            ],
        ),
        dashboard.init(),
    ],
    mode="asgi",
)
