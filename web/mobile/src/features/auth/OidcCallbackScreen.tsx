import {useEffect, useRef, useState} from "react"

import {TurnstileWidget} from "@agenta/auth-ui"
import Link from "next/link"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {completeOidcSignIn, isTurnstileEnabled, setPendingTurnstileToken} from "@/lib/auth"

import {useAuthSuccess} from "./useAuthSuccess"

/**
 * Landing for an OIDC redirect the mobile app started. The provider redirected
 * to the desktop `/auth/callback/<id>` (the only registered URI) and the device
 * gate forwarded it here with the query intact; signInAndUp reads the OAuth
 * state from the same-origin sessionStorage and exchanges the code.
 *
 * On EE the exchange itself is a guarded auth POST, so — exactly as the desktop
 * callback does — the code is not sent until the Turnstile widget has produced a
 * token. Without one the API refuses the exchange and the sign-in dies here.
 */
export const OidcCallbackScreen = () => {
    const router = useRouter()
    const onSuccess = useAuthSuccess()
    const started = useRef(false)
    const [error, setError] = useState<string | null>(null)
    // "unknown" until mounted: the site key is runtime config (`__env.js`), which the prerender
    // cannot see, so deciding during render would hydrate against the wrong answer.
    const [turnstile, setTurnstile] = useState<"unknown" | "needed" | "ready">("unknown")
    const turnstileReady = turnstile === "ready"

    useEffect(() => {
        setTurnstile(isTurnstileEnabled() ? "needed" : "ready")
    }, [])

    useEffect(() => {
        // Wait for the query so a missing code reads as "not ready", not "failed".
        if (!router.isReady || started.current) return

        if (!router.query.code && !router.query.state) {
            started.current = true
            void router.replace("/auth")
            return
        }

        if (!turnstileReady) return
        started.current = true

        void (async () => {
            const outcome = await completeOidcSignIn()
            setPendingTurnstileToken(null)
            if (outcome.kind === "ok") {
                await onSuccess()
                return
            }
            setError(outcome.message)
        })()
    }, [router, router.isReady, onSuccess, turnstileReady])

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
            <AgentaLogo className="text-foreground h-6 w-auto" />
            {error ? (
                <>
                    <p className="text-destructive text-xs" role="alert">
                        {error}
                    </p>
                    <Link href="/auth" className="-m-3 p-3 text-xs underline underline-offset-4">
                        Back to sign in
                    </Link>
                </>
            ) : (
                <p className="text-muted-foreground text-xs">Finishing sign-in…</p>
            )}
            {turnstile === "needed" && !error ? (
                <TurnstileWidget
                    className="flex justify-center"
                    onTokenChange={(token) => {
                        if (!token) return
                        setPendingTurnstileToken(token)
                        setTurnstile("ready")
                    }}
                    onError={() => setError("Security check failed. Try again.")}
                />
            ) : null}
        </div>
    )
}
