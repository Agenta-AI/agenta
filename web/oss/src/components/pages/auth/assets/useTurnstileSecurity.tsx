import {useCallback, useMemo, useRef, useState} from "react"

import type {AuthMessage, AuthSecurityAdapter} from "@agenta/auth-ui"

import {
    clearPendingTurnstileToken,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@/oss/lib/helpers/auth/turnstile"

import TurnstileWidget, {TurnstileWidgetHandle} from "../Turnstile"

/**
 * The EE security seam: adapts Cloudflare Turnstile (widget + the pending-token side channel
 * the API middleware reads) to the package's neutral AuthSecurityAdapter. Returns undefined
 * when the deployment has no Turnstile — the forms then skip the whole dance.
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
            ensureToken: () => {
                if (tokenRef.current) return tokenRef.current
                setMessage({message: "Please complete the security check.", type: "error"})
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
                            message: "Security check failed. Please try again.",
                            type: "error",
                        })
                    }
                />
            ),
        }
    }, [enabled, handleTokenChange, setMessage])
}
