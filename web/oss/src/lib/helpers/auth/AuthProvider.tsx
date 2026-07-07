import {useEffect, useCallback, useState} from "react"

import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"

import {installTurnstileFetchPatch} from "@/oss/lib/helpers/auth/turnstile"

import {AuthProviderType} from "./types"

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const [isInitialized, setIsInitialized] = useState(false)
    useEffect(() => {
        const initSuperTokens = async () => {
            installTurnstileFetchPatch()
            // Lazy: `frontendConfig` statically imports the emailpassword/passwordless/
            // thirdparty recipes (the prebuilt-UI-bearing modules). Init already runs
            // post-mount in this effect, so importing it here keeps those recipes out of
            // the shared `_app` chunk. The session recipe stays eager via useSession.
            const {frontendConfig} = await import("@/oss/config/frontendConfig")
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
