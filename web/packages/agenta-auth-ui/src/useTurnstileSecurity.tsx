import {useCallback, useMemo, useRef, useState} from "react"

import {
    clearPendingTurnstileToken,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@agenta/auth"
import {createT} from "@agenta/i18n"
import sharedCatalog from "@agenta/i18n/catalogs/auth.shared"

import {TurnstileWidget, type TurnstileWidgetHandle} from "./TurnstileWidget"
import type {AuthMessage, AuthSecurityAdapter} from "./types"

const tNow = createT(sharedCatalog)

/**
 * The EE security seam: adapts Cloudflare Turnstile (widget + the pending-token side channel
 * the API middleware reads) to the neutral AuthSecurityAdapter the forms take. Returns undefined
 * when the deployment has no Turnstile — the forms then skip the whole dance. Shared by the
 * desktop and /m so both send the token the API insists on.
 */
export const useTurnstileSecurity = (
    setMessage: (message: AuthMessage) => void,
): AuthSecurityAdapter | undefined => {
    const enabled = isTurnstileEnabled()
    const [token, setToken] = useState<string | null>(null)
    const widgetRef = useRef<TurnstileWidgetHandle>(null)
    const tokenRef = useRef<string | null>(null)
    tokenRef.current = token

    const handleTokenChange = useCallback((next: string | null) => setToken(next), [])

    return useMemo(() => {
        if (!enabled) return undefined
        return {
            hasToken: token !== null,
            ensureToken: () => {
                if (tokenRef.current) return tokenRef.current
                setMessage({message: tNow("auth.shared.completeSecurityCheck"), type: "error"})
                return null
            },
            stampToken: (value) => setPendingTurnstileToken(value),
            clearToken: () => {
                clearPendingTurnstileToken()
                setToken(null)
                widgetRef.current?.reset()
            },
            refreshToken: async () => {
                const next = widgetRef.current ? await widgetRef.current.refreshToken() : null
                setToken(next)
                return next
            },
            widget: (
                <TurnstileWidget
                    ref={widgetRef}
                    className="flex justify-center"
                    onTokenChange={handleTokenChange}
                    onError={() =>
                        setMessage({
                            message: tNow("auth.shared.securityCheckFailed"),
                            type: "error",
                        })
                    }
                />
            ),
        }
    }, [enabled, token, handleTokenChange, setMessage])
}
