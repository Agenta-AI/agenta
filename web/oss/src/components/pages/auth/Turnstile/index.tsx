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

        useEffect(() => {
            onErrorRef.current = onError
        }, [onError])

        useEffect(() => {
            onTokenChangeRef.current = onTokenChange
        }, [onTokenChange])

        useImperativeHandle(
            ref,
            () => ({
                reset: () => {
                    if (widgetIdRef.current && window.turnstile) {
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
                        callback: (token) => onTokenChangeRef.current(token),
                        "error-callback": () => {
                            onTokenChangeRef.current(null)
                            onErrorRef.current?.()
                        },
                        "expired-callback": () => onTokenChangeRef.current(null),
                        "timeout-callback": () => {
                            onTokenChangeRef.current(null)
                            onErrorRef.current?.()
                        },
                    })
                })
                .catch(() => {
                    if (!cancelled) {
                        onTokenChangeRef.current(null)
                        onErrorRef.current?.()
                    }
                })

            return () => {
                cancelled = true

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
