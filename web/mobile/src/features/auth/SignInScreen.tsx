import {useState, type ReactNode} from "react"

import {
    AuthDivider,
    AuthShell,
    EmailChip,
    EmailFirstForm,
    EmailPasswordForm,
    OtpVerifyForm,
    PasswordlessRequestForm,
    RegionSelector,
    SocialAuthButtons,
    useSignInFlow,
    useTurnstileSecurity,
    type AuthSuccessPayload,
} from "@agenta/auth-ui"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {clearEmailCodeAttempt, shouldShowRegionSelector, startOidcSignIn} from "@/lib/auth"

import {providerIcon} from "./providerIcons"
import {AuthMethodsSkeleton} from "./states/AuthMethodsSkeleton"
import {NoAuthMethods} from "./states/NoAuthMethods"
import {useAuthSuccess} from "./useAuthSuccess"

const TERMS_URL = "https://agenta.ai/docs/administration/security/terms-of-service"
const PRIVACY_URL = "https://agenta.ai/docs/administration/security/privacy-policy"

/**
 * Email first: ask for an address, discover what it can use, then show only that. A returning
 * visitor is greeted back and finds their last method tagged "Last used" (and their address
 * filled in, when it was email).
 *
 * The flow itself is `useSignInFlow` from @agenta/auth-ui; this screen renders it plus the one
 * transport that differs: /m routes its OIDC redirect through a cookie so the desktop's
 * registered callback URI still works. On EE the password and OTP forms take the Turnstile
 * adapter, since the API refuses every auth POST without a token.
 */
export const SignInScreen = () => {
    const onSuccess = useAuthSuccess()
    const router = useRouter()
    const [pendingProvider, setPendingProvider] = useState<string | null>(null)

    const flow = useSignInFlow({
        query: router.query,
        startThirdParty: async (thirdPartyId) => {
            // Resolves only on failure — success navigates away.
            await startOidcSignIn(thirdPartyId)
            throw new Error(`Could not reach ${thirdPartyId}`)
        },
    })
    const {entry, methods, message, setMessage} = flow
    const security = useTurnstileSecurity(setMessage)

    const onEmailSuccess = (payload: AuthSuccessPayload) =>
        onSuccess({
            method: "email",
            email: flow.email,
            isNewUser: Boolean(payload.createdNewRecipeUser),
        })

    const startProvider = async (providerId: string) => {
        if (pendingProvider) return
        setPendingProvider(providerId)
        await startOidcSignIn(providerId)
        setPendingProvider(null)
        setMessage({message: "Could not reach that provider. Try again.", type: "error"})
    }

    const changeEmail = async () => {
        if (flow.stage === "code") await clearEmailCodeAttempt()
        flow.useDifferentEmail()
    }

    let chip: ReactNode = null
    let heading = entry.heading
    let subheading = entry.isReturning
        ? "Sign in to continue to your workspace."
        : "Sign in or create an account."
    let body: ReactNode

    if (!flow.ready || flow.restoring) {
        body = <AuthMethodsSkeleton />
    } else if (!entry.showEmailEntry && entry.providers.length === 0) {
        body = <NoAuthMethods />
    } else if (flow.stage === "code") {
        chip = <EmailChip email={flow.email} onChange={() => void changeEmail()} />
        heading = "Check your inbox"
        subheading = "Enter the 6-character code we sent to your email."
        body = (
            <OtpVerifyForm
                email={flow.email}
                message={message}
                setMessage={setMessage}
                onSuccess={onEmailSuccess}
                onRestart={flow.useDifferentEmail}
                onAuthError={flow.reportError}
            />
        )
    } else if (flow.stage === "methods") {
        chip = <EmailChip email={flow.email} onChange={() => void changeEmail()} />
        if (methods.password) {
            heading = "Enter your password"
            subheading = "New to Agenta? The password you choose here creates your account."
        } else if (methods.otp) {
            heading = "Get a sign-in code"
            subheading = "We will email a one-time code to this address."
        } else {
            heading = "Sign in with SSO"
            subheading = "Your organization manages sign-in for this email."
        }
        body = (
            <div className="flex w-full flex-col gap-[22px]">
                {methods.password ? (
                    <EmailPasswordForm
                        message={message}
                        setMessage={setMessage}
                        initialEmail={flow.email}
                        lockEmail
                        security={security}
                        onAuthError={flow.reportError}
                        onSuccess={onEmailSuccess}
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
                        security={security}
                    />
                ) : null}
                {(methods.password || methods.otp) && methods.sso.length ? <AuthDivider /> : null}
                {methods.sso.map((provider) => (
                    <button
                        key={provider.id}
                        type="button"
                        className={methods.password || methods.otp ? "auth-surface-btn" : "auth-btn-yellow"}
                        disabled={flow.redirecting}
                        onClick={() => void flow.startSso(provider)}
                    >
                        {flow.redirecting
                            ? `Redirecting to ${provider.label}…`
                            : `Continue with SSO (${provider.label})`}
                    </button>
                ))}
                {!methods.password && !methods.otp && methods.sso.length === 0 ? (
                    <p className="auth-subline m-0">
                        This email has no sign-in method here. Try another address.
                    </p>
                ) : null}
            </div>
        )
    } else {
        // On a cloud host the data-residency switch comes first: an account lives in one
        // region, and the wrong one signs nobody in.
        body = (
            <div className="flex w-full flex-col gap-[22px]">
                {shouldShowRegionSelector() ? <RegionSelector /> : null}
                {entry.providers.length ? (
                    <SocialAuthButtons
                        providers={entry.providers.map((provider) => ({
                            ...provider,
                            icon: providerIcon(provider.id),
                        }))}
                        onSelect={(providerId) => void startProvider(providerId)}
                        isLoading={pendingProvider !== null}
                        pendingProviderId={pendingProvider ?? undefined}
                        disabled={flow.discovering}
                        lastUsedProviderId={entry.promotedProvider?.id}
                    />
                ) : null}
                {entry.providers.length && entry.showEmailEntry ? <AuthDivider /> : null}
                {entry.showEmailEntry ? (
                    <EmailFirstForm
                        email={flow.email}
                        setEmail={flow.setEmail}
                        onContinue={flow.continueWithEmail}
                        message={message}
                        disabled={pendingProvider !== null}
                        promoted={entry.promotedEmail}
                    />
                ) : null}
                <p className="auth-terms m-0">
                    By continuing, you agree to Agenta&apos;s{" "}
                    <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
                        Terms of Service
                    </a>{" "}
                    and{" "}
                    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                        Privacy Policy
                    </a>
                    .
                </p>
            </div>
        )
    }

    return (
        <AuthShell header={<AgentaLogo className="h-[23px] w-auto text-[var(--a-heading)]" />}>
            {chip}
            <header className="flex flex-col gap-1">
                <h1 className="auth-headline auth-headline-form m-0">{heading}</h1>
                <p className="auth-subline m-0 text-pretty">{subheading}</p>
            </header>
            {body}
        </AuthShell>
    )
}
