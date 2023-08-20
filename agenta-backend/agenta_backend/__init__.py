from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import passwordless, session, dashboard

from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
from supertokens_python.recipe.passwordless.interfaces import (
    APIInterface,
    APIOptions,
    ConsumeCodePostOkResult,
)
from typing import Any, Dict, Union


def override_passwordless_apis(original_implementation: APIInterface):
    original_consume_code_post = original_implementation.consume_code_post

    async def consume_code_post(
        pre_auth_session_id: str,
        user_input_code: Union[str, None],
        device_id: Union[str, None],
        link_code: Union[str, None],
        api_options: APIOptions,
        user_context: Dict[str, Any],
    ):
        # First we call the original implementation of consume_code_post.
        response = await original_consume_code_post(
            pre_auth_session_id,
            user_input_code,
            device_id,
            link_code,
            api_options,
            user_context,
        )

        # Post sign up response, we check if it was successful
        if isinstance(response, ConsumeCodePostOkResult):
            _ = response.user.user_id
            __ = response.user.email
            ___ = response.user.phone_number

            if response.created_new_user:
                print("------------- holaaaaa sign up")
                # create a new organisation
                # create a new user(with the same id?)

                pass  # TODO: Post sign up logic
            else:
                print("------------- holaaaaa sign iiiin")
                pass  # TODO: Post sign in logic

        return response

    original_implementation.consume_code_post = consume_code_post
    return original_implementation


init(
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain="http://localhost",
        website_domain="http://localhost",
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
        passwordless.init(
            flow_type="USER_INPUT_CODE",
            contact_config=ContactEmailOnlyConfig(),
            override=passwordless.InputOverrideConfig(apis=override_passwordless_apis),
        ),
        dashboard.init(),
    ],
    mode="asgi",
)
