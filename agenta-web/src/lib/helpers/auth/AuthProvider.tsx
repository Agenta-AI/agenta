import {useEffect, useCallback} from "react"
import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"
import {AuthProviderType} from "./types"
import {isDemo} from "../utils"
import {dynamicConfig} from "../dynamic"
;(async () => {
    if (typeof window !== "undefined" && isDemo()) {
        const {frontendConfig} = await dynamicConfig("frontendConfig")
        SuperTokensReact.init(frontendConfig())
    }
})()

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const doRefresh = useCallback(async () => {
        if (!isDemo()) return

        if (pageProps.fromSupertokens === "needs-refresh") {
            const session = await import("supertokens-auth-react/recipe/session")

            if (await session.attemptRefreshingSession()) {
                location.reload()
            } else {
                SuperTokensReact.redirectToAuth()
            }
        }
    }, [pageProps.fromSupertokens])

    useEffect(() => {
        doRefresh()
    }, [doRefresh])

    if (isDemo() && pageProps.fromSupertokens === "needs-refresh") {
        return null
    }

    return isDemo() ? <SuperTokensWrapper>{children}</SuperTokensWrapper> : <>{children}</>
}

export default AuthProvider
