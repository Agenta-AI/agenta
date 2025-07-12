from urllib.parse import urlparse
from typing import Optional, Any, Dict, Union, List

from supertokens_python.types import AccountInfo
from supertokens_python.asyncio import list_users_by_account_info
from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.asyncio import get_user as get_user_from_supertokens
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
from supertokens_python.recipe import emailpassword
from supertokens_python.recipe.emailpassword.types import FormField
from supertokens_python.recipe.emailpassword.utils import (
    InputSignUpFeature,
    InputOverrideConfig,
)
from supertokens_python.recipe.emailpassword.types import InputFormField
from supertokens_python.recipe.thirdparty.interfaces import (
    APIInterface as ThirdPartyAPIInterface,
    SignInUpPostOkResult,
)
from supertokens_python.recipe.emailpassword.interfaces import (
    APIInterface as EmailPasswordAPIInterface,
    APIOptions as EmailPasswordAPIOptions,
    SignUpPostOkResult as EmailPasswordSignUpPostOkResult,
)

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.services.exceptions import UnauthorizedException
from oss.src.services.db_manager import (
    get_user_with_email,
    check_if_user_invitation_exists,
    check_if_user_exists_and_create_organization,
)
from oss.src.utils.validators import (
    validate_user_email_or_username,
    validate_actual_email,
    is_input_email,
)


def _is_blocked(email: str) -> bool:
    email = email.lower()
    if email in env.AGENTA_BLOCKED_EMAILS:
        return True
    if "@" in email and email.split("@")[-1] in env.AGENTA_BLOCKED_DOMAINS:
        return True
    return False


if is_ee():
    from ee.src.services.commoners import create_accounts
else:
    from oss.src.services.db_manager import create_accounts


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
            if is_ee() and _is_blocked(response.user.emails[0]):
                raise UnauthorizedException(detail="This email is not allowed.")
            payload = {
                "uid": response.user.id,
                "email": response.user.emails[0],
            }
            if is_ee():
                await create_accounts(payload)
            else:
                raise Exception(
                    "passwordless account creation is not available in OSS."
                )

        return response

    original_implementation.consume_code = consume_code_post  # type: ignore
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

        if isinstance(response, SignInUpPostOkResult):
            if is_ee() and _is_blocked(response.user.emails[0]):
                raise UnauthorizedException(detail="This email is not allowed.")
            payload = {
                "uid": response.user.id,
                "email": response.user.emails[0],
            }
            if is_ee():
                await create_accounts(payload)
            else:
                raise Exception(
                    "third-party-api account creation is not available in OSS."
                )

        return response

    original_implementation.sign_in_up_post = thirdparty_sign_in_up_post  # type: ignore

    return original_implementation


def override_password_apis(original: EmailPasswordAPIInterface):
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
            if is_ee() and _is_blocked(form_fields[0].value):
                raise UnauthorizedException(detail="This email is not allowed.")
            user_id = await get_user_with_email(form_fields[0].value)
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
        # FLOW 1: Sign in
        email = form_fields[0].value
        if is_ee() and _is_blocked(email):
            raise UnauthorizedException(detail="This email is not allowed.")
        user_info_from_st = await list_users_by_account_info(
            tenant_id="public", account_info=AccountInfo(email=email)
        )
        if len(user_info_from_st) >= 1 or await get_user_with_email(email=email):
            return await sign_in_post(
                form_fields,
                tenant_id,
                session,
                should_try_linking_with_session_user,
                api_options,
                user_context,
            )

        # FLOW 2: Sign up (as organization & workspace owner)
        organization_db = await check_if_user_exists_and_create_organization(
            user_email=email
        )

        # FLOW 3: Sign up (as a regular user after accepting invitation)
        # DISABLED: Allow signup without invitation
        # user_invitation_exists = await check_if_user_invitation_exists(
        #     email=email,
        #     organization_id=str(organization_db.id),
        # )
        # if not user_invitation_exists:
        #     raise UnauthorizedException(
        #         detail="You need to be invited by the organization owner to gain access."
        #     )

        response = await og_sign_up_post(
            form_fields,
            tenant_id,
            session,
            should_try_linking_with_session_user,
            api_options,
            user_context,
        )
        if isinstance(response, EmailPasswordSignUpPostOkResult):
            # sign up successful
            actual_email = ""
            for field in form_fields:
                if field.id == "email":
                    actual_email = field.value

            if actual_email == "":
                # User did not provide an email.
                # This is possible since we set optional: true
                # in the form field config
                pass
            else:
                email = (
                    actual_email
                    if "@" in actual_email
                    else f"{actual_email}@localhost.com"
                )
                payload = {
                    "uid": response.user.id,
                    "email": email,
                    "organization_id": str(organization_db.id),
                }
                await create_accounts(payload)

        return response

    original.sign_up_post = sign_up_post  # type: ignore
    original.sign_in_post = sign_in_post  # type: ignore
    return original


# Parse AGENTA_API_URL to extract domain and path
try:
    parsed_api_url = urlparse(env.AGENTA_API_URL)
    if not parsed_api_url.scheme or not parsed_api_url.netloc:
        raise ValueError("Invalid AGENTA_API_URL: missing scheme or netloc")

    api_domain = f"{parsed_api_url.scheme}://{parsed_api_url.netloc}"
    api_gateway_path = parsed_api_url.path or "/"
except Exception as e:
    print(f"[ERROR] Failed to parse AGENTA_API_URL ('{env.AGENTA_API_URL}'): {e}")
    api_domain = ""
    api_gateway_path = "/"


init(
    # debug=True,
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain=api_domain,
        website_domain=env.AGENTA_WEB_URL,
        api_gateway_path=api_gateway_path,
        api_base_path="/auth/",
        website_base_path="/auth",
    ),
    supertokens_config=SupertokensConfig(
        connection_uri=env.SUPERTOKENS_CONNECTION_URI,
        api_key=env.SUPERTOKENS_API_KEY,
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
                                    client_id=env.GOOGLE_OAUTH_CLIENT_ID,
                                    client_secret=env.GOOGLE_OAUTH_CLIENT_SECRET,
                                ),
                            ],
                        ),
                    ),
                    ProviderInput(
                        config=ProviderConfig(
                            third_party_id="github",
                            clients=[
                                ProviderClientConfig(
                                    client_id=env.GITHUB_OAUTH_CLIENT_ID,
                                    client_secret=env.GITHUB_OAUTH_CLIENT_SECRET,
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
        emailpassword.init(
            sign_up_feature=InputSignUpFeature(
                form_fields=[
                    InputFormField(
                        id="email", validate=validate_user_email_or_username
                    ),
                    InputFormField(
                        id="actualEmail", validate=validate_actual_email, optional=True
                    ),
                ]
            ),
            override=InputOverrideConfig(
                apis=override_password_apis,
            ),
        ),
        session.init(expose_access_token_to_frontend_in_cookie_based_auth=True),
        dashboard.init(),
    ],
    mode="asgi",
)
