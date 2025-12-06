import Router from "next/router"
import {SuperTokensConfig} from "supertokens-auth-react/lib/build/types"
import EmailPassword from "supertokens-auth-react/recipe/emailpassword"
import PasswordlessReact from "supertokens-auth-react/recipe/passwordless"
import SessionReact from "supertokens-auth-react/recipe/session"
import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty"

import {appInfo} from "./appInfo"
import {getEnv} from "../lib/helpers/dynamicEnv"

export const frontendConfig = (): SuperTokensConfig => {
    const authnEmail = getEnv("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL") || "password"
    const googleOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID")
    const githubOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID")

    // Build recipe list based on enabled auth methods
    const recipeList: any[] = []

    // Add OIDC (ThirdParty) if Google or GitHub OAuth is configured
    const oidcProviders = []
    if (googleOAuthClientId) {
        oidcProviders.push(ThirdPartyReact.Google.init())
    }
    if (githubOAuthClientId) {
        oidcProviders.push(ThirdPartyReact.Github.init())
    }

    if (oidcProviders.length > 0) {
        recipeList.push(
            ThirdPartyReact.init({
                signInAndUpFeature: {
                    providers: oidcProviders,
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
