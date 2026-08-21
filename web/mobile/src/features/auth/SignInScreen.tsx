import {useState} from "react"

import {
    AuthDivider,
    AuthShell,
    EmailFirstForm,
    EmailPasswordForm,
    OtpVerifyForm,
    PasswordlessRequestForm,
    SocialAuthButtons,
    useSignInFlow,
} from "@agenta/auth-ui"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {startOidcSignIn} from "@/lib/auth"

import {providerIcon} from "./providerIcons"
import {AuthMethodsSkeleton} from "./states/AuthMethodsSkeleton"
import {NoAuthMethods} from "./states/NoAuthMethods"
import {useAuthSuccess} from "./useAuthSuccess"

/**
 * Every method this deployment enables: social, password or one-time code, and whatever org SSO
 * the address turns out to have.
 *
 * The flow itself — ask for an address, discover what it can use, then show only that — is
 * `useSignInFlow` from @agenta/auth-ui, the same one the desktop page drives. This screen is the
 * rendering of it plus the one transport that differs: /m routes its OIDC redirect through a
 * cookie so the desktop's registered callback URI still works.
 */
export const SignInScreen = () => {
    const onSuccess = useAuthSuccess()
    const router = useRouter()
    const [oidcLoading, setOidcLoading] = useState(false)

    const flow = useSignInFlow({
        query: router.query,
        startThirdParty: async (thirdPartyId) => {
            // Resolves only on failure — success navigates away.
            await startOidcSignIn(thirdPartyId)
            throw new Error(`Could not reach ${thirdPartyId}`)
        },
    })
    const {entry, methods, message, setMessage} = flow

    const startProvider = async (providerId: string) => {
        if (oidcLoading) return
        setOidcLoading(true)
        await startOidcSignIn(providerId)
        setOidcLoading(false)
        setMessage({message: "Could not reach that provider. Try again.", type: "error"})
    }

    const socialButtons = (providers: typeof entry.providers, promoted = false) =>
        providers.length ? (
            <SocialAuthButtons
                providers={providers.map((provider) => ({
                    ...provider,
                    icon: providerIcon(provider.id),
                }))}
                onSelect={(providerId) => void startProvider(providerId)}
                isLoading={oidcLoading}
                disabled={flow.discovering}
                variant={promoted ? "promoted" : "default"}
                yellow={promoted}
                lastUsedProviderId={promoted ? providers[0]?.id : undefined}
            />
        ) : null

    const emailEntry = entry.showEmailEntry ? (
        <EmailFirstForm
            email={flow.email}
            setEmail={flow.setEmail}
            onContinue={flow.continueWithEmail}
            message={message}
            disabled={oidcLoading}
            primary={!entry.promotedProvider}
            promoted={entry.promotedEmail}
        />
    ) : null

    let body
    if (!flow.ready || flow.restoring) {
        body = <AuthMethodsSkeleton />
    } else if (!entry.showEmailEntry && entry.providers.length === 0) {
        body = <NoAuthMethods />
    } else if (flow.stage === "code") {
        body = (
            <OtpVerifyForm
                email={flow.email}
                message={message}
                setMessage={setMessage}
                onSuccess={async () => onSuccess()}
                onRestart={() => flow.setCodeSent(false)}
                onAuthError={flow.reportError}
            />
        )
    } else if (flow.stage === "methods") {
        body = (
            <div className="flex w-full flex-col gap-4">
                {methods.password ? (
                    <EmailPasswordForm
                        message={message}
                        setMessage={setMessage}
                        initialEmail={flow.email}
                        lockEmail
                        onAuthError={flow.reportError}
                        onSuccess={async () => onSuccess()}
                    />
                ) : null}
                {methods.otp ? (
                    <PasswordlessRequestForm
                        email={flow.email}
                        setEmail={flow.setEmail}
                        message={message}
                        setMessage={setMessage}
                        onCodeSent={() => flow.setCodeSent(true)}
                        onAuthError={flow.reportError}
                        lockEmail
                    />
                ) : null}
                {(methods.password || methods.otp) && methods.sso.length ? <AuthDivider /> : null}
                {methods.sso.map((provider) => (
                    <button
                        key={provider.id}
                        type="button"
                        className="auth-surface-btn"
                        disabled={flow.redirecting}
                        onClick={() => void flow.startSso(provider)}
                    >
                        {flow.redirecting
                            ? `Opening ${provider.label}…`
                            : `Continue with SSO (${provider.label})`}
                    </button>
                ))}
                <button type="button" className="auth-quiet-btn" onClick={flow.useDifferentEmail}>
                    Use a different email
                </button>
            </div>
        )
    } else {
        // The entry screen, ordered by what the visitor used last: the remembered method first,
        // the rest under a divider.
        body = (
            <div className="flex w-full flex-col gap-4">
                {entry.promotedProvider ? socialButtons([entry.promotedProvider], true) : null}
                {entry.promotedProvider && (entry.otherProviders.length || emailEntry) ? (
                    <AuthDivider />
                ) : null}
                {entry.promotedEmail ? emailEntry : null}
                {entry.promotedEmail && entry.otherProviders.length ? <AuthDivider /> : null}
                {socialButtons(entry.otherProviders)}
                {!entry.promotedEmail && emailEntry ? (
                    <>
                        {entry.otherProviders.length && !entry.promotedProvider ? (
                            <AuthDivider />
                        ) : null}
                        {emailEntry}
                    </>
                ) : null}
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
                    {entry.heading}
                </h1>
                {!entry.isReturning ? (
                    <p className="auth-subline m-0">Sign in or create an account.</p>
                ) : null}
            </header>
            {body}
        </AuthShell>
    )
}
