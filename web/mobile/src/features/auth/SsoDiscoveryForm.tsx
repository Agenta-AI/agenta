import {useState, type FormEvent} from "react"

import {startOidcSignIn} from "@/lib/auth"
import {discoverSsoProviders, type DiscoveredSsoProvider} from "@/lib/auth/discover"

import {authFieldClass, authPrimaryButtonClass, authQuietButtonClass} from "./authStyles"

type Phase = "idle" | "asking" | "checking" | "results"

/**
 * Organization SSO: ask for the work email, let the backend name the org's
 * providers, then run the same redirect flow as the social buttons.
 */
export const SsoDiscoveryForm = () => {
    const [phase, setPhase] = useState<Phase>("idle")
    const [email, setEmail] = useState("")
    const [providers, setProviders] = useState<DiscoveredSsoProvider[]>([])
    const [error, setError] = useState<string | null>(null)
    const [redirecting, setRedirecting] = useState<string | null>(null)

    const check = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (phase === "checking") return
        setPhase("checking")
        setError(null)
        const result = await discoverSsoProviders(email.trim())
        if (result.kind === "failed") {
            setPhase("asking")
            setError(result.message)
            return
        }
        if (result.providers.length === 0) {
            setPhase("asking")
            setError("No SSO is configured for that email.")
            return
        }
        setProviders(result.providers)
        setPhase("results")
    }

    const start = async (thirdPartyId: string) => {
        if (redirecting) return
        setRedirecting(thirdPartyId)
        setError(null)
        // Resolves only on failure — success navigates away.
        await startOidcSignIn(thirdPartyId)
        setRedirecting(null)
        setError("Could not reach that provider. Try again.")
    }

    if (phase === "idle") {
        return (
            <button
                type="button"
                onClick={() => setPhase("asking")}
                className={authQuietButtonClass}
            >
                Sign in with organization SSO
            </button>
        )
    }

    if (phase === "results") {
        return (
            <div className="flex w-full flex-col gap-2">
                {providers.map((provider) => (
                    <button
                        key={provider.id}
                        type="button"
                        onClick={() => start(provider.thirdPartyId)}
                        disabled={Boolean(redirecting)}
                        className={authPrimaryButtonClass}
                    >
                        {redirecting === provider.thirdPartyId
                            ? `Opening ${provider.label}…`
                            : `Continue with SSO (${provider.label})`}
                    </button>
                ))}
                {error ? (
                    <p className="text-destructive text-xs" role="alert">
                        {error}
                    </p>
                ) : null}
                <button
                    type="button"
                    onClick={() => setPhase("asking")}
                    className={authQuietButtonClass}
                >
                    Use a different email
                </button>
            </div>
        )
    }

    return (
        <form className="flex w-full flex-col gap-3" onSubmit={check}>
            <input
                type="email"
                autoComplete="email"
                required
                placeholder="Work email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={authFieldClass}
            />
            {error ? (
                <p className="text-destructive text-xs" role="alert">
                    {error}
                </p>
            ) : null}
            <button
                type="submit"
                disabled={phase === "checking"}
                className={authPrimaryButtonClass}
            >
                {phase === "checking" ? "Checking…" : "Continue with SSO"}
            </button>
        </form>
    )
}
