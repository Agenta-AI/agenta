import {useEffect, useCallback, useState} from "react"

import {configureAxios} from "@agenta/shared/api"
import SuperTokensReact, {SuperTokensWrapper} from "supertokens-auth-react"

import {frontendConfig} from "@/oss/config/frontendConfig"
import {installTurnstileFetchPatch} from "@/oss/lib/helpers/auth/turnstile"
import {getJWT} from "@/oss/services/api"

import {AuthProviderType} from "./types"

const AuthProvider: AuthProviderType = ({children, pageProps}) => {
    const [isInitialized, setIsInitialized] = useState(false)
    useEffect(() => {
        const initSuperTokens = async () => {
            installTurnstileFetchPatch()
            SuperTokensReact.init(frontendConfig())
            // Wire the shared (`@agenta/shared/api`) axios — used by ALL
            // entities-package queries — with the same SuperTokens auth the OSS
            // axios has. Without this it never attaches a fresh token: `getJWT()`
            // → `Session.getAccessToken()` auto-refreshes an expired access token,
            // so entities queries (e.g. the always-mounted sidebar's current-
            // workflow by-id query, which fires earliest) stop intermittently
            // 401-ing on a stale token. Configured before children mount (and thus
            // before any query fires), since we only render once `isInitialized`.
            configureAxios({
                requestInterceptor: async (config) => {
                    const jwt = await getJWT()
                    if (jwt) config.headers.set("Authorization", `Bearer ${jwt}`)
                    return config
                },
            })
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
