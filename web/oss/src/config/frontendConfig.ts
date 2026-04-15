import Router from "next/router"
import {SuperTokensConfig} from "supertokens-auth-react/lib/build/types"
import EmailPassword from "supertokens-auth-react/recipe/emailpassword"
import PasswordlessReact from "supertokens-auth-react/recipe/passwordless"
import SessionReact from "supertokens-auth-react/recipe/session"
import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty"

import {getEffectiveAuthConfig, getEnv} from "../lib/helpers/dynamicEnv"

import {appInfo} from "./appInfo"

/**
 * Validate a password against the configured SuperTokens password policy.
 *
 * Mirrors the logic in api/oss/src/utils/validators.py:validate_password().
 * Resolution order:
 *   1. Custom regex (NEXT_PUBLIC_SUPERTOKENS_PASSWORD_REGEX) — full-match required.
 *   2. Policy "none"   — no validation.
 *   3. Policy "basic"  — min/max length only.
 *   4. Policy "strong" — basic + uppercase, digit, special char.
 */
const validatePassword = (value: string): Promise<string | undefined> => {
    const policy = (getEnv("NEXT_PUBLIC_SUPERTOKENS_PASSWORD_POLICY") || "strong").toLowerCase()
    const minLength = parseInt(getEnv("NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MIN_LENGTH") || "8", 10)
    const maxLengthRaw = getEnv("NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MAX_LENGTH")
    const maxLength = maxLengthRaw ? parseInt(maxLengthRaw, 10) : null
    const regex = getEnv("NEXT_PUBLIC_SUPERTOKENS_PASSWORD_REGEX")

    if (regex) {
        // Anchor the pattern so it behaves like Python's fullmatch().
        return Promise.resolve(
            new RegExp(`^${regex}$`).test(value)
                ? undefined
                : "Password does not meet the required format.",
        )
    }

    if (policy === "none") {
        return Promise.resolve(undefined)
    }

    if (value.length < minLength) {
        return Promise.resolve(`Password must be at least ${minLength} characters long.`)
    }

    if (maxLength !== null && value.length > maxLength) {
        return Promise.resolve(`Password must be at most ${maxLength} characters long.`)
    }

    if (policy === "strong") {
        if (!/[A-Z]/.test(value)) {
            return Promise.resolve("Password must contain at least one uppercase letter.")
        }
        if (!/[0-9]/.test(value)) {
            return Promise.resolve("Password must contain at least one digit.")
        }
        if (!/[!@#$%^&*()_+\-=[\]{}|;':",./<>?]/.test(value)) {
            return Promise.resolve(
                "Password must contain at least one special character (!@#$%^&* etc.).",
            )
        }
    }

    return Promise.resolve(undefined)
}

export const frontendConfig = (): SuperTokensConfig => {
    const {authnEmail, oidcProviders} = getEffectiveAuthConfig()

    // Build recipe list based on enabled auth methods
    const recipeList: any[] = []

    const providerInitializers: Record<string, () => any> = {
        google: () => ThirdPartyReact.Google.init(),
        "google-workspaces": () => ThirdPartyReact.GoogleWorkspaces.init(),
        github: () => ThirdPartyReact.Github.init(),
        facebook: () => ThirdPartyReact.Facebook.init(),
        apple: () => ThirdPartyReact.Apple.init(),
        discord: () => ThirdPartyReact.Discord.init(),
        twitter: () => ThirdPartyReact.Twitter.init(),
        gitlab: () => ThirdPartyReact.Gitlab.init(),
        bitbucket: () => ThirdPartyReact.Bitbucket.init(),
        linkedin: () => ThirdPartyReact.LinkedIn.init(),
        okta: () => ThirdPartyReact.Okta.init(),
        "azure-ad": () => ThirdPartyReact.ActiveDirectory.init({id: "azure-ad", name: "Azure AD"}),
        "boxy-saml": () => ThirdPartyReact.BoxySAML.init(),
    }

    const thirdPartyProviders = oidcProviders
        .map((provider) => providerInitializers[provider.id]?.())
        .filter(Boolean)

    recipeList.push(
        ThirdPartyReact.init({
            signInAndUpFeature: {
                providers: thirdPartyProviders,
            },
        }),
    )

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
                                validate: validatePassword,
                            },
                        ],
                    },
                },
            }),
        )
    }

    // Add Passwordless (OTP) if authnEmail is "otp"
    if (authnEmail === "otp") {
        recipeList.push(
            PasswordlessReact.init({
                contactMethod: "EMAIL",
            }),
        )
    }

    // Session is always required
    recipeList.push(SessionReact.init())

    return {
        appInfo,
        // Allow empty provider list so dynamic SSO providers can be used.
        usesDynamicLoginMethods: true,
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
