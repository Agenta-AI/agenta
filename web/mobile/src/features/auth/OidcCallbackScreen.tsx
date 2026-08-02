import {useEffect, useRef, useState} from "react"

import Link from "next/link"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {completeOidcSignIn} from "@/lib/auth"

import {useAuthSuccess} from "./useAuthSuccess"

/**
 * Landing for an OIDC redirect the mobile app started. The provider redirected
 * to the desktop `/auth/callback/<id>` (the only registered URI) and the device
 * gate forwarded it here with the query intact; signInAndUp reads the OAuth
 * state from the same-origin sessionStorage and exchanges the code.
 */
export const OidcCallbackScreen = () => {
    const router = useRouter()
    const onSuccess = useAuthSuccess()
    const started = useRef(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // Wait for the query so a missing code reads as "not ready", not "failed".
        if (!router.isReady || started.current) return
        started.current = true

        if (!router.query.code && !router.query.state) {
            void router.replace("/auth")
            return
        }

        void (async () => {
            const outcome = await completeOidcSignIn()
            if (outcome.kind === "ok") {
                await onSuccess()
                return
            }
            setError(outcome.message)
        })()
    }, [router, router.isReady, onSuccess])

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
        </div>
    )
}
