import Router from "next/router"
import {SuperTokensConfig} from "supertokens-auth-react/lib/build/types"
import PasswordlessReact from "supertokens-auth-react/recipe/passwordless"
import SessionReact from "supertokens-auth-react/recipe/session"
import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty"

import {appInfo} from "./appInfo"

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
