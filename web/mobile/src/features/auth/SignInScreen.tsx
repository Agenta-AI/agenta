import {useEffect, useState, type FormEvent} from "react"

import {useRouter} from "next/router"

import {getEmailSignInMode, signInWithEmailPassword, type EmailSignInMode} from "@/lib/auth"
import {queryClient} from "@/lib/queryClient"

/** Raw email/password sign-in (auth-lite). OIDC/social stays a desktop flow. */
export const SignInScreen = () => {
    const router = useRouter()
    // Mode reads window.__env — resolve after mount so SSR markup never differs.
    const [mode, setMode] = useState<EmailSignInMode | null>(null)
    useEffect(() => setMode(getEmailSignInMode()), [])

    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (pending) return
        setPending(true)
        setError(null)
        const outcome = await signInWithEmailPassword(email.trim(), password)
        if (outcome.kind === "ok") {
            // Drop the cached unauthenticated verdict before the resolver reruns.
            await queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
            void router.replace("/")
            return
        }
        setPending(false)
        setError(outcome.kind === "rejected" ? outcome.message : "Something went wrong. Try again.")
    }

    let body
    if (mode === null) {
        body = <p className="text-muted-foreground text-center text-xs">Loading…</p>
    } else if (mode !== "password") {
        body = (
            <p className="text-muted-foreground text-center text-xs">
                {mode === "otp"
                    ? "Email code sign-in is not available here."
                    : "Email sign-in is disabled on this deployment."}
            </p>
        )
    } else {
        body = (
            <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
                <input
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="border-border bg-background rounded-md border px-3 py-2 text-base"
                />
                <input
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="border-border bg-background rounded-md border px-3 py-2 text-base"
                />
                {error ? <p className="text-destructive text-xs">{error}</p> : null}
                <button
                    type="submit"
                    disabled={pending}
                    className="border-border min-h-11 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                    {pending ? "Signing in…" : "Sign in"}
                </button>
            </form>
        )
    }

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
            <p className="text-sm font-medium">Sign in to Agenta</p>
            {body}
            <p className="text-muted-foreground text-center text-xs">
                For SSO or social sign-in, use the desktop app.
            </p>
        </div>
    )
}
