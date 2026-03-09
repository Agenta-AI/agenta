import {forwardRef, useEffect, useImperativeHandle, useRef} from "react"

import {getTurnstileSiteKey} from "@/oss/lib/helpers/auth/turnstile"

const TURNSTILE_SCRIPT_ID = "agenta-turnstile-script"
const TURNSTILE_SCRIPT_SRC =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

let turnstileScriptPromise: Promise<void> | null = null

type TurnstileRenderOptions = {
    sitekey: string
    callback?: (token: string) => void
    theme?: "light" | "dark" | "auto"
    "error-callback"?: () => void
    "expired-callback"?: () => void
    "timeout-callback"?: () => void
}

type TurnstileApi = {
    render: (container: HTMLElement, options: TurnstileRenderOptions) => string
    remove: (widgetId: string) => void
    reset: (widgetId: string) => void
}

declare global {
    interface Window {
        turnstile?: TurnstileApi
    }
}

export interface TurnstileWidgetHandle {
    refreshToken: () => Promise<string | null>
    reset: () => void
}

interface TurnstileWidgetProps {
    className?: string
    onError?: () => void
    onTokenChange: (token: string | null) => void
}

const loadTurnstileScript = () => {
    if (typeof window === "undefined") {
        return Promise.resolve()
    }

    if (window.turnstile) {
        return Promise.resolve()
    }

    if (turnstileScriptPromise) {
        return turnstileScriptPromise
    }

    turnstileScriptPromise = new Promise<void>((resolve, reject) => {
        const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as
            | HTMLScriptElement
            | null

        if (existingScript) {
            existingScript.addEventListener("load", () => resolve(), {once: true})
            existingScript.addEventListener("error", () => reject(new Error("load error")), {
                once: true,
            })
            return
        }

        const script = document.createElement("script")
        script.id = TURNSTILE_SCRIPT_ID
        script.src = TURNSTILE_SCRIPT_SRC
        script.async = true
        script.defer = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error("load error"))
        document.head.appendChild(script)
    }).catch((err) => {
        turnstileScriptPromise = null
        document.getElementById(TURNSTILE_SCRIPT_ID)?.remove()
        throw err
    })

    return turnstileScriptPromise
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
    ({className, onError, onTokenChange}, ref) => {
        const siteKey = getTurnstileSiteKey()
        const containerRef = useRef<HTMLDivElement | null>(null)
        const widgetIdRef = useRef<string | null>(null)
        const onErrorRef = useRef(onError)
        const onTokenChangeRef = useRef(onTokenChange)
        const pendingTokenResolverRef = useRef<((token: string | null) => void) | null>(null)
        const pendingTokenRejecterRef = useRef<((error: Error) => void) | null>(null)

        useEffect(() => {
            onErrorRef.current = onError
        }, [onError])

        useEffect(() => {
            onTokenChangeRef.current = onTokenChange
        }, [onTokenChange])

        const clearPendingTokenRequest = () => {
            pendingTokenResolverRef.current = null
            pendingTokenRejecterRef.current = null
        }

        const rejectPendingTokenRequest = (message: string) => {
            if (pendingTokenRejecterRef.current) {
                pendingTokenRejecterRef.current(new Error(message))
            }

            clearPendingTokenRequest()
        }

        const emitToken = (token: string | null) => {
            onTokenChangeRef.current(token)

            if (token && pendingTokenResolverRef.current) {
                pendingTokenResolverRef.current(token)
                clearPendingTokenRequest()
            }
        }

        const emitError = (message: string) => {
            onTokenChangeRef.current(null)

            rejectPendingTokenRequest(message)

            onErrorRef.current?.()
        }

        useImperativeHandle(
            ref,
            () => ({
                refreshToken: () => {
                    if (!widgetIdRef.current || !window.turnstile) {
                        return Promise.resolve(null)
                    }

                    clearPendingTokenRequest()

                    return new Promise<string | null>((resolve, reject) => {
                        pendingTokenResolverRef.current = resolve
                        pendingTokenRejecterRef.current = reject
                        onTokenChangeRef.current(null)
                        window.turnstile?.reset(widgetIdRef.current!)
                    })
                },
                reset: () => {
                    if (widgetIdRef.current && window.turnstile) {
                        rejectPendingTokenRequest("Turnstile token refresh was cancelled.")
                        onTokenChangeRef.current(null)
                        window.turnstile.reset(widgetIdRef.current)
                    }
                },
            }),
            [],
        )

        useEffect(() => {
            if (!siteKey || !containerRef.current || typeof window === "undefined") {
                return
            }

            let cancelled = false

            loadTurnstileScript()
                .then(() => {
                    if (
                        cancelled ||
                        !containerRef.current ||
                        !window.turnstile ||
                        widgetIdRef.current
                    ) {
                        return
                    }

                    widgetIdRef.current = window.turnstile.render(containerRef.current, {
                        sitekey: siteKey,
                        theme: "light",
                        callback: (token) => emitToken(token),
                        "error-callback": () => emitError("Turnstile challenge failed."),
                        "expired-callback": () => emitError("Turnstile token expired."),
                        "timeout-callback": () => emitError("Turnstile challenge timed out."),
                    })
                })
                .catch(() => {
                    if (!cancelled) {
                        emitError("Turnstile failed to load.")
                    }
                })

            return () => {
                cancelled = true
                rejectPendingTokenRequest("Turnstile token refresh was cancelled.")

                if (widgetIdRef.current && window.turnstile) {
                    window.turnstile.remove(widgetIdRef.current)
                    widgetIdRef.current = null
                }
            }
        }, [siteKey])

        if (!siteKey) {
            return null
        }

        return (
            <div className={className}>
                <div ref={containerRef} />
            </div>
        )
    },
)

TurnstileWidget.displayName = "TurnstileWidget"

export default TurnstileWidget
