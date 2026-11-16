import {useEffect, useRef, useState} from "react"

import {TurnstileWidget} from "@agenta/auth-ui"
import {useT} from "@agenta/i18n"
import oidcCatalog from "@agenta/i18n/catalogs/auth.oidcCallback"
import {Button} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {postAuthBootAtom} from "@/features/app/postAuthBoot"
import {
    claimOAuthCode,
    completeOidcSignIn,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@/lib/auth"

import {useAuthSuccess} from "./useAuthSuccess"

/**
 * Landing for an OIDC redirect the mobile app started. The provider redirected
 * to the root `/auth/callback/<id>` (the only registered URI) and `proxy.ts`
 * forwarded it here with the query intact; signInAndUp reads the OAuth
 * state from the same-origin sessionStorage and exchanges the code.
 *
 * On EE the exchange itself is a guarded auth POST, so the code is not sent until the
 * Turnstile widget has produced a token. Without one the API refuses the exchange and the
 * sign-in dies here.
 */
export const OidcCallbackScreen = () => {
    const t = useT(oidcCatalog)
    const router = useRouter()
    const onSuccess = useAuthSuccess()
    const startBoot = useSetAtom(postAuthBootAtom)
    const started = useRef(false)
    // A catalog key for our own messages, or the server's text, which is shown as it comes.
    const [error, setError] = useState<
        {key: "codeUsed" | "signedInButAppFailed" | "securityCheckFailed"} | {text: string} | null
    >(null)
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
        const code = router.query.code
        if (!claimOAuthCode(Array.isArray(code) ? code[0] : code)) {
            setError({key: "codeUsed"})
            return
        }
        // The post-auth loader covers the exchange, so the screen goes straight to it.
        startBoot({account: "pending", startedAt: Date.now()})

        void (async () => {
            const outcome = await completeOidcSignIn()
            setPendingTurnstileToken(null)
            if (outcome.kind === "ok") {
                const provider = router.query.provider
                try {
                    await onSuccess({
                        method: (Array.isArray(provider) ? provider[0] : provider) ?? "oidc",
                        isNewUser: outcome.createdNewUser,
                    })
                } catch {
                    setError({key: "signedInButAppFailed"})
                }
                return
            }
            startBoot(null)
            setError({text: outcome.message})
        })()
    }, [router, router.isReady, onSuccess, startBoot, turnstileReady])

    // Behind the loader there is nothing to show until an error or a security check needs the page.
    if (!error && turnstile !== "needed") return <div className="bg-background min-h-dvh" />

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
            <AgentaLogo className="text-foreground h-6 w-auto" />
            {error ? (
                <>
                    <p className="text-destructive text-xs" role="alert">
                        {"key" in error ? t(`auth.oidcCallback.${error.key}`) : error.text}
                    </p>
                    <Button asChild variant="link" size="sm" className="text-xs text-foreground">
                        <Link href="/auth">{t("auth.oidcCallback.backToSignIn")}</Link>
                    </Button>
                </>
            ) : null}
            {turnstile === "needed" && !error ? (
                <TurnstileWidget
                    className="flex justify-center"
                    onTokenChange={(token) => {
                        if (!token) return
                        setPendingTurnstileToken(token)
                        setTurnstile("ready")
                    }}
                    onError={() => setError({key: "securityCheckFailed"})}
                />
            ) : null}
        </div>
    )
}
