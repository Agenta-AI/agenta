from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import passwordless, session, dashboard

from supertokens_python.recipe.passwordless import ContactEmailOnlyConfig
init(
    app_info=InputAppInfo(
        app_name="agenta",
        api_domain="http://localhost",
        website_domain="http://localhost",
        # the fact that both are localhost is causing problems with
        # displaying the dashboard to manage users
        api_base_path="/auth/",
        website_base_path="/auth"
    ),
    supertokens_config=SupertokensConfig(
        connection_uri="http://supertokens:3567",
    ),
    framework='fastapi',
    recipe_list=[
        session.init(),  # initializes session features
        passwordless.init(
            flow_type="USER_INPUT_CODE",
            contact_config=ContactEmailOnlyConfig()
        ),
        dashboard.init(),
    ],
    mode='asgi'
)
