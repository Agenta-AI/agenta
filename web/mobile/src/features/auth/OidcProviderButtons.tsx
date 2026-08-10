import {useState} from "react"

import {startOidcSignIn, type OidcProvider} from "@/lib/auth"

import {authPrimaryButtonClass} from "./authStyles"

interface OidcProviderButtonsProps {
    providers: OidcProvider[]
}

/** One button per configured provider; clicking leaves for the provider. */
export const OidcProviderButtons = ({providers}: OidcProviderButtonsProps) => {
    const [redirecting, setRedirecting] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const start = async (providerId: string) => {
        if (redirecting) return
        setRedirecting(providerId)
        setError(null)
        // Resolves only on failure — success navigates away.
        await startOidcSignIn(providerId)
        setRedirecting(null)
        setError("Could not reach that provider. Try again.")
    }

    if (providers.length === 0) return null

    return (
        <div className="flex w-full flex-col gap-2">
            {providers.map((provider) => (
                <button
                    key={provider.id}
                    type="button"
                    onClick={() => start(provider.id)}
                    disabled={Boolean(redirecting)}
                    className={authPrimaryButtonClass}
                >
                    {redirecting === provider.id
                        ? `Opening ${provider.label}…`
                        : `Continue with ${provider.label}`}
                </button>
            ))}
            {error ? (
                <p className="text-destructive text-xs" role="alert">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
