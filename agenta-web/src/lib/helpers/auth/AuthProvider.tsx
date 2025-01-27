import {useEffect, useCallback, useState} from "react"
import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"
import {AuthProviderType} from "./types"
import {isDemo} from "../utils"
import {dynamicConfig} from "../dynamic"

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const [isInitialized, setIsInitialized] = useState(false)
    useEffect(() => {
        const initSuperTokens = async () => {
            const {frontendConfig} = await dynamicConfig("frontendConfig")
            SuperTokensReact.init(frontendConfig())
            setIsInitialized(true)
        }
        if (typeof window !== "undefined" && isDemo()) {
            initSuperTokens()
        }
    }, [])

    const doRefresh = useCallback(async () => {
        if (isDemo() && pageProps.fromSupertokens === "needs-refresh") {
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

    if (!isDemo()) {
        return <>{children}</>
    } else if (isInitialized) {
        return <SuperTokensWrapper>{children}</SuperTokensWrapper>
    } else {
        return null
    }
}

export default AuthProvider
