import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty"
import PasswordlessReact from "supertokens-auth-react/recipe/passwordless"
import {SuperTokensConfig} from "supertokens-auth-react/lib/build/types"
import SessionReact from "supertokens-auth-react/recipe/session"
import {appInfo} from "./appInfo"
import Router from "next/router"

export const frontendConfig = (): SuperTokensConfig => {
    return {
        appInfo,
        // enableDebugLogs: true,
        termsOfServiceLink: "https://agenta.ai/terms-and-conditions-demo",
        privacyPolicyLink: "https://agenta.ai/privacy-policy-demo",
        recipeList: [
            ThirdPartyReact.init({
                signInAndUpFeature: {
                    providers: [ThirdPartyReact.Github.init(), ThirdPartyReact.Google.init()],
                },
            }),
            PasswordlessReact.init({
                contactMethod: "EMAIL",
            }),
            SessionReact.init(),
        ],

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
