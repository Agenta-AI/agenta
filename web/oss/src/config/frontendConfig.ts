import Router from "next/router"
import {SuperTokensConfig} from "supertokens-auth-react/lib/build/types"
import EmailPassword from "supertokens-auth-react/recipe/emailpassword"
import PasswordlessReact from "supertokens-auth-react/recipe/passwordless"
import SessionReact from "supertokens-auth-react/recipe/session"
import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty"

import {appInfo} from "./appInfo"
import {getEffectiveAuthConfig} from "../lib/helpers/dynamicEnv"

export const frontendConfig = (): SuperTokensConfig => {
    const {authnEmail, oidcProviders} = getEffectiveAuthConfig()

    // Build recipe list based on enabled auth methods
    const recipeList: any[] = []

    const providerInitializers: Record<string, () => any> = {
        "google": () => ThirdPartyReact.Google.init(),
        "google-workspaces": () => ThirdPartyReact.GoogleWorkspaces.init(),
        "github": () => ThirdPartyReact.Github.init(),
        "facebook": () => ThirdPartyReact.Facebook.init(),
        "apple": () => ThirdPartyReact.Apple.init(),
        "discord": () => ThirdPartyReact.Discord.init(),
        "twitter": () => ThirdPartyReact.Twitter.init(),
        "gitlab": () => ThirdPartyReact.Gitlab.init(),
        "bitbucket": () => ThirdPartyReact.Bitbucket.init(),
        "linkedin": () => ThirdPartyReact.LinkedIn.init(),
        "okta": () => ThirdPartyReact.Okta.init(),
        "azure-ad": () =>
            ThirdPartyReact.ActiveDirectory.init({id: "azure-ad", name: "Azure AD"}),
        "boxy-saml": () => ThirdPartyReact.BoxySAML.init(),
    }

    const thirdPartyProviders = oidcProviders
        .map((provider) => providerInitializers[provider.id]?.())
        .filter(Boolean)

    if (thirdPartyProviders.length > 0) {
        recipeList.push(
            ThirdPartyReact.init({
                signInAndUpFeature: {
                    providers: thirdPartyProviders,
                },
            })
        )
    }

    // Add Email-Password if authnEmail is "password"
    if (authnEmail === "password") {
        recipeList.push(
            EmailPassword.init({
                signInAndUpFeature: {
                    signUpForm: {
                        formFields: [
                            {
                                id: "email",
                                label: "Email",
                                placeholder: "Custom value",
                            },
                            {
                                id: "password",
                                label: "Password",
                                placeholder: "Custom value",
                            },
                        ],
                    },
                },
            })
        )
    }

    // Add Passwordless (OTP) if authnEmail is "otp"
    if (authnEmail === "otp") {
        recipeList.push(
            PasswordlessReact.init({
                contactMethod: "EMAIL",
            })
        )
    }

    // Session is always required
    recipeList.push(SessionReact.init())

    return {
        appInfo,
        // enableDebugLogs: true,
        termsOfServiceLink: "https://agenta.ai/terms-and-conditions-demo",
        privacyPolicyLink: "https://agenta.ai/privacy-policy-demo",
        recipeList,

        windowHandler: (oI: any) => {
            return {
                ...oI,
                location: {
                    ...oI.location,
                    setHref: (href: string) => {
                        Router.push(href)
                    },
                },
            }
        },
    }
}
