from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import passwordless, session, dashboard

from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
from supertokens_python.recipe.passwordless.interfaces import (
    APIInterface,
    APIOptions,
    ConsumeCodePostOkResult,
)
from typing import Any, Dict, Union
from agenta_backend.models.api.auth_models import (
    User,
    Organization,
)
from agenta_backend.services.user_service import create_new_user
from agenta_backend.services.organization_service import (
    create_new_organization,
)


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
            user_dict = {
                "id": response.user.user_id,
                "email": response.user.email,
                "username": response.user.email.split("@")[0],
            }
            organization = Organization(**{"name": user_dict["username"]})

            if response.created_new_user:
                print("================ SIGNUP ====================")
                org = await create_new_organization(organization)

                user_dict["organization_id"] = str(org.inserted_id)
                user = User(**user_dict)
                await create_new_user(user)

        return response

    original_implementation.consume_code_post = consume_code_post
    return original_implementation


init(
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain="http://localhost/api",
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
            override=passwordless.InputOverrideConfig(
                apis=override_passwordless_apis
            ),
        ),
        dashboard.init(),
    ],
    mode="asgi",
)
