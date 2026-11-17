import {useState, type ReactNode} from "react"

import {sendsCodeAtOnce} from "@agenta/auth"
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
    HEADLINE_CLASS,
    KEYCAP_CLASS,
    SUBLINE_CLASS,
    SURFACE_CLASS,
    type AuthSuccessPayload,
    type SignInStage,
} from "@agenta/auth-ui"
import {richText, useT} from "@agenta/i18n"
import signInCatalog from "@agenta/i18n/catalogs/auth.signIn"
import {LoadingButton} from "@agenta/ui/ui"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"
import {clearEmailCodeAttempt, shouldShowRegionSelector, startOidcSignIn} from "@/lib/auth"
import {useMotionPresets} from "@/lib/motion/presets"

import {providerIcon} from "./providerIcons"
import {AuthMethodsSkeleton} from "./states/AuthMethodsSkeleton"
import {NoAuthMethods} from "./states/NoAuthMethods"
import {useAuthSuccess, type AuthSuccess} from "./useAuthSuccess"

const TERMS_URL = "https://agenta.ai/docs/administration/security/terms-of-service"
const PRIVACY_URL = "https://agenta.ai/docs/administration/security/privacy-policy"

/** Step order, so a step change knows whether it moves forward or back. */
const STAGE_ORDER: Record<SignInStage, number> = {entry: 0, methods: 1, code: 2}

/** Email-first sign-in on `useSignInFlow`; /m routes OIDC through a cookie, EE adds Turnstile. */
export const SignInScreen = () => {
    const t = useT(signInCatalog)
    const onSuccess = useAuthSuccess()
    const router = useRouter()
    const [pendingProvider, setPendingProvider] = useState<string | null>(null)
    const [leaving, setLeaving] = useState(false)
    const {authLeaveMs} = useMotionPresets()

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

    const [step, setStep] = useState({stage: flow.stage, direction: "fwd"})
    if (step.stage !== flow.stage) {
        const forward = STAGE_ORDER[flow.stage] > STAGE_ORDER[step.stage]
        setStep({stage: flow.stage, direction: forward ? "fwd" : "back"})
    }

    // The screen plays its exit first; the post-auth loader then fades in over it.
    const leaveThen = async (success: AuthSuccess) => {
        setLeaving(true)
        await new Promise((resolve) => setTimeout(resolve, authLeaveMs))
        try {
            await onSuccess(success)
        } catch {
            setLeaving(false)
            setMessage({
                message: t("auth.signIn.signedInButAppFailed"),
                type: "error",
            })
        }
    }

    const onEmailSuccess = (payload: AuthSuccessPayload) =>
        leaveThen({
            method: "email",
            email: flow.email,
            isNewUser: Boolean(payload.createdNewRecipeUser),
        })

    const startProvider = async (providerId: string) => {
        if (pendingProvider) return
        setPendingProvider(providerId)
        await startOidcSignIn(providerId)
        setPendingProvider(null)
        setMessage({message: t("auth.signIn.providerUnreachable"), type: "error"})
    }

    const changeEmail = async () => {
        if (flow.stage === "code") await clearEmailCodeAttempt()
        flow.useDifferentEmail()
    }

    let chip: ReactNode = null
    let heading = entry.isReturning
        ? t("auth.signIn.headingReturning")
        : t("auth.signIn.headingNew")
    let subheading = entry.isReturning
        ? t("auth.signIn.subheadingReturning")
        : t("auth.signIn.subheadingNew")
    let body: ReactNode
    const loading = !flow.ready || flow.restoring

    if (loading) {
        body = <AuthMethodsSkeleton />
    } else if (!entry.showEmailEntry && entry.providers.length === 0) {
        body = <NoAuthMethods />
    } else if (flow.stage === "code") {
        chip = <EmailChip email={flow.email} onChange={() => void changeEmail()} />
        heading = t("auth.signIn.codeHeading")
        subheading = t("auth.signIn.codeSubheading")
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
            heading = t("auth.signIn.passwordHeading")
            subheading = t("auth.signIn.passwordSubheading")
        } else if (methods.otp) {
            heading = t("auth.signIn.otpHeading")
            subheading = t("auth.signIn.otpSubheading")
        } else {
            heading = t("auth.signIn.ssoHeading")
            subheading = t("auth.signIn.ssoSubheading")
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
                        autoSend={sendsCodeAtOnce(methods)}
                    />
                ) : null}
                {(methods.password || methods.otp) && methods.sso.length ? <AuthDivider /> : null}
                {methods.sso.map((provider) => (
                    <LoadingButton
                        key={provider.id}
                        type="button"
                        size="lg"
                        variant={methods.password || methods.otp ? "outline" : "default"}
                        className={methods.password || methods.otp ? SURFACE_CLASS : KEYCAP_CLASS}
                        loading={flow.redirecting}
                        onClick={() => void flow.startSso(provider)}
                    >
                        {flow.redirecting
                            ? t("auth.signIn.redirectingTo", {provider: provider.label})
                            : t("auth.signIn.continueWithSso", {provider: provider.label})}
                    </LoadingButton>
                ))}
                {!methods.password && !methods.otp && methods.sso.length === 0 ? (
                    <p className={SUBLINE_CLASS}>{t("auth.signIn.noMethodForEmail")}</p>
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
                <p className="m-0 text-xs leading-[18px] text-muted-foreground [&_a]:text-muted-foreground [&_a]:no-underline [&_a:hover]:text-foreground [&_a:hover]:underline">
                    {richText(t("auth.signIn.termsNotice"), {
                        terms: (text) => (
                            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
                                {text}
                            </a>
                        ),
                        privacy: (text) => (
                            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                                {text}
                            </a>
                        ),
                    })}
                </p>
            </div>
        )
    }

    return (
        <AuthShell
            leaving={leaving}
            header={<AgentaLogo className="h-[23px] w-auto text-foreground" />}
        >
            <div
                key={loading ? "loading" : flow.stage}
                className={`flex flex-col gap-[22px] auth-step-${step.direction}`}
            >
                {chip}
                <header className="flex flex-col gap-1">
                    <h1 className={HEADLINE_CLASS}>{heading}</h1>
                    <p className={SUBLINE_CLASS}>{subheading}</p>
                </header>
                {body}
            </div>
        </AuthShell>
    )
}
