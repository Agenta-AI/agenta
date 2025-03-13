import {useEffect, useCallback, useState} from "react"

import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"

import {frontendConfig} from "@/oss/config/frontendConfig"

import {AuthProviderType} from "./types"

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const [isInitialized, setIsInitialized] = useState(false)
    useEffect(() => {
        const initSuperTokens = async () => {
            SuperTokensReact.init(frontendConfig())
            setIsInitialized(true)
        }
        if (typeof window !== "undefined" && !isInitialized) {
            initSuperTokens()
        }
    }, [isInitialized])

    const doRefresh = useCallback(async () => {
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

    if (isInitialized) {
        return <SuperTokensWrapper>{children}</SuperTokensWrapper>
    } else {
        return null
    }
}

export default AuthProvider
