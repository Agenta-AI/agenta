import {useEffect, useCallback, useState} from "react"

import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"

import {frontendConfig} from "@/oss/config/frontendConfig"

import {isDemo} from "../utils"

import {AuthProviderType} from "./types"

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const [isInitialized, setIsInitialized] = useState(false)
    useEffect(() => {
        if (!isDemo()) return
        const initSuperTokens = async () => {
            SuperTokensReact.init(frontendConfig())
            setIsInitialized(true)
        }
        if (typeof window !== "undefined" && isDemo() && !isInitialized) {
            initSuperTokens()
        }
    }, [isInitialized])

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
