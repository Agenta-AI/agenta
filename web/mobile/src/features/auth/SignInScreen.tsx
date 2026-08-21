import {useEffect, useState} from "react"

import {
    AuthDivider,
    AuthShell,
    EmailPasswordForm,
    OtpVerifyForm,
    PasswordlessRequestForm,
    SocialAuthButtons,
    type AuthMessage,
} from "@agenta/auth-ui"

import {providerIcon} from "./providerIcons"
import {SsoDiscoveryForm} from "./SsoDiscoveryForm"
import {AuthMethodsSkeleton} from "./states/AuthMethodsSkeleton"
import {NoAuthMethods} from "./states/NoAuthMethods"
import {useAuthSuccess} from "./useAuthSuccess"

import {AgentaLogo} from "@/components/AgentaLogo"
import {
    getEmailSignInMode,
    isOidcEnabled,
    listOidcProviders,
    startOidcSignIn,
    type EmailSignInMode,
    type OidcProvider,
} from "@/lib/auth"

interface ResolvedMethods {
    mode: EmailSignInMode
    providers: OidcProvider[]
    /** Org-SSO discovery is worth offering whenever the deployment enables OIDC. */
    ssoDiscovery: boolean
}

const EMPTY_MESSAGE = {} as AuthMessage

/**
 * Every method this deployment enables: password OR one-time code, social, org SSO — the
 * same components (and the same auth.css design) as the desktop sign-in, on mobile's shell.
 */
export const SignInScreen = () => {
    const onSuccess = useAuthSuccess()
    // Methods read window.__env — resolve after mount so SSR markup never differs.
    const [methods, setMethods] = useState<ResolvedMethods | null>(null)
    const [message, setMessage] = useState<Partial<AuthMessage>>(EMPTY_MESSAGE)
    const [email, setEmail] = useState("")
    const [codeSent, setCodeSent] = useState(false)
    const [oidcLoading, setOidcLoading] = useState(false)
    useEffect(
        () =>
            setMethods({
                mode: getEmailSignInMode(),
                providers: listOidcProviders(),
                ssoDiscovery: isOidcEnabled(),
            }),
        [],
    )

    const startProvider = async (providerId: string) => {
        if (oidcLoading) return
        setOidcLoading(true)
        // Resolves only on failure — success navigates away.
        await startOidcSignIn(providerId)
        setOidcLoading(false)
        setMessage({message: "Could not reach that provider. Try again.", type: "error"})
    }

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
                <EmailPasswordForm
                    message={message}
                    setMessage={setMessage}
                    onSuccess={async () => onSuccess()}
                />
            ) : methods.mode === "otp" ? (
                codeSent ? (
                    <OtpVerifyForm
                        email={email}
                        message={message}
                        setMessage={setMessage}
                        onSuccess={async () => onSuccess()}
                        onRestart={() => {
                            setCodeSent(false)
                            setMessage(EMPTY_MESSAGE)
                        }}
                    />
                ) : (
                    <PasswordlessRequestForm
                        email={email}
                        setEmail={setEmail}
                        message={message}
                        setMessage={setMessage}
                        onCodeSent={() => setCodeSent(true)}
                    />
                )
            ) : null
        body = (
            <div className="flex w-full flex-col gap-4">
                <SocialAuthButtons
                    providers={methods.providers.map((provider) => ({
                        ...provider,
                        icon: providerIcon(provider.id),
                    }))}
                    onSelect={(providerId) => void startProvider(providerId)}
                    isLoading={oidcLoading}
                />
                {methods.providers.length > 0 && emailBlock ? <AuthDivider /> : null}
                {emailBlock}
                {methods.ssoDiscovery ? <SsoDiscoveryForm /> : null}
            </div>
        )
    }

    // The frame, the column and the panel are the package's (`AuthShell`) — the same one oss and
    // ee render, so /m is the desktop sign-in, not a second version of it. The corner logo is
    // desktop-only; on a phone it sits centered with the form, the way this screen shipped.
    return (
        <AuthShell
            header={<AgentaLogo className="h-6 w-auto text-[var(--a-heading)]" />}
            headerClassName="hidden lg:block"
        >
            <header className="flex flex-col items-center gap-3 lg:items-start lg:gap-1">
                <AgentaLogo className="h-6 w-auto text-[var(--a-heading)] lg:hidden" />
                <h1 className="auth-headline auth-headline-form m-0 hidden lg:block">
                    Welcome to Agenta
                </h1>
                <p className="auth-subline m-0">Sign in or create an account.</p>
            </header>
            {body}
        </AuthShell>
    )
}
