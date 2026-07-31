import {useEffect, useState} from "react"

import {
    getEmailSignInMode,
    isOidcEnabled,
    listOidcProviders,
    type EmailSignInMode,
    type OidcProvider,
} from "@/lib/auth"

import {AuthDivider} from "./AuthDivider"
import {EmailOtpForm} from "./EmailOtpForm"
import {EmailPasswordForm} from "./EmailPasswordForm"
import {OidcProviderButtons} from "./OidcProviderButtons"
import {SsoDiscoveryForm} from "./SsoDiscoveryForm"
import {AuthMethodsSkeleton} from "./states/AuthMethodsSkeleton"
import {NoAuthMethods} from "./states/NoAuthMethods"
import {useAuthSuccess} from "./useAuthSuccess"

interface ResolvedMethods {
    mode: EmailSignInMode
    providers: OidcProvider[]
    /** Org-SSO discovery is worth offering whenever the deployment enables OIDC. */
    ssoDiscovery: boolean
}

/** Every method this deployment enables: password OR one-time code, social, org SSO. */
export const SignInScreen = () => {
    const onSuccess = useAuthSuccess()
    // Methods read window.__env — resolve after mount so SSR markup never differs.
    const [methods, setMethods] = useState<ResolvedMethods | null>(null)
    useEffect(
        () =>
            setMethods({
                mode: getEmailSignInMode(),
                providers: listOidcProviders(),
                ssoDiscovery: isOidcEnabled(),
            }),
        [],
    )

    let body
    if (methods === null) {
        body = <AuthMethodsSkeleton />
    } else if (
        methods.mode === "disabled" &&
        methods.providers.length === 0 &&
        !methods.ssoDiscovery
    ) {
        body = <NoAuthMethods />
    } else {
        const emailBlock =
            methods.mode === "password" ? (
                <EmailPasswordForm onSuccess={onSuccess} />
            ) : methods.mode === "otp" ? (
                <EmailOtpForm onSuccess={onSuccess} />
            ) : null
        body = (
            <div className="flex w-full flex-col gap-4">
                <OidcProviderButtons providers={methods.providers} />
                {methods.providers.length > 0 && emailBlock ? <AuthDivider /> : null}
                {emailBlock}
                {methods.ssoDiscovery ? <SsoDiscoveryForm /> : null}
            </div>
        )
    }

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
            <p className="text-sm font-medium">Sign in to Agenta</p>
            <div className="flex w-full max-w-sm flex-col items-center gap-4">{body}</div>
        </div>
    )
}
