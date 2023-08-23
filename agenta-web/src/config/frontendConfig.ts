import ThirdPartyPasswordless from "supertokens-auth-react/recipe/thirdpartypasswordless"
import SessionReact from "supertokens-auth-react/recipe/session"
import {appInfo} from "./appInfo"
import Router from "next/router"

export const frontendConfig = () => {
    return {
        appInfo,
        recipeList: [
            ThirdPartyPasswordless.init({
                contactMethod: "EMAIL",
                signInUpFeature: {
                    providers: [
                        ThirdPartyPasswordless.Github.init(),
                        ThirdPartyPasswordless.Google.init(),
                    ],
                },
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
