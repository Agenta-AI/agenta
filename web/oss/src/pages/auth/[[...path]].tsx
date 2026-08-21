import {useCallback, useMemo, useState, type ReactNode} from "react"

import {firstQueryValue} from "@agenta/auth"
import {AuthShell, useSignInFlow} from "@agenta/auth-ui"
import ProtectedRoute from "@agenta/oss/src/components/ProtectedRoute/ProtectedRoute"
import {
    AppleOutlined,
    FacebookOutlined,
    GithubOutlined,
    GoogleOutlined,
    LinkedinOutlined,
    TwitterOutlined,
    GlobalOutlined,
} from "@ant-design/icons"
import {Alert, Button, Select, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {
    clearLoginAttemptInfo,
    getLoginAttemptInfo,
} from "supertokens-auth-react/recipe/passwordless"
import {signOut} from "supertokens-auth-react/recipe/session"
import {getAuthorisationURLWithQueryParamsAndSetState} from "supertokens-auth-react/recipe/thirdparty"
import {useLocalStorage} from "usehooks-ts"

import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {
    AgentaPasswordlessAttempt,
    syncInitialPasswordlessAttempt,
} from "@/oss/components/pages/auth/assets/passwordlessAttempt"
import "@/oss/lib/auth/configureAuthPackage"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {getDisplayFontUrl, getEffectiveAuthConfig} from "@/oss/lib/helpers/dynamicEnv"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {shouldShowRegionSelector} from "@/oss/lib/helpers/region"
import {isDemo} from "@/oss/lib/helpers/utils"
import {orgsAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {sessionExistsAtom} from "@/oss/state/session"

const PasswordlessAuth = dynamic(() => import("@/oss/components/pages/auth/PasswordlessAuth"))
const EmailPasswordAuth = dynamic(() => import("@/oss/components/pages/auth/EmailPasswordAuth"))
const EmailFirst = dynamic(() => import("@/oss/components/pages/auth/EmailFirst"))
const SocialAuth = dynamic(() => import("@/oss/components/pages/auth/SocialAuth"), {ssr: false})
const SendOTP = dynamic(() => import("@/oss/components/pages/auth/SendOTP"), {ssr: false})
const RegionSelector = dynamic(() => import("@/oss/components/pages/auth/RegionSelector"), {
    ssr: false,
})

const {Text} = Typography

/** Provider id → this app's icon. The package knows which providers exist, not how they look. */
const PROVIDER_ICONS: Record<string, ReactNode> = {
    google: <GoogleOutlined />,
    "google-workspaces": <GoogleOutlined />,
    github: <GithubOutlined />,
    facebook: <FacebookOutlined />,
    apple: <AppleOutlined />,
    twitter: <TwitterOutlined />,
    linkedin: <LinkedinOutlined />,
}

const withProviderIcon = (provider: {id: string; label: string}) => ({
    ...provider,
    icon: PROVIDER_ICONS[provider.id] ?? <GlobalOutlined />,
})

const Auth = () => {
    const {appTheme} = useAppTheme()
    const isDark = appTheme === ThemeMode.Dark
    const router = useRouter()
    const [isSocialAuthLoading, setIsSocialAuthLoading] = useState(false)
    const [invite, setInvite] = useLocalStorage("invite", {})

    const {authnEmail} = getEffectiveAuthConfig()
    const isPasswordlessDemo = isDemo() && authnEmail === "otp"

    // Reopen an OTP attempt this browser left open (demo installs sign in with codes).
    const resumeCodeAttempt = useCallback(async () => {
        const attempt = await syncInitialPasswordlessAttempt({
            currentApiUrl: getAgentaApiUrl(),
            getLoginAttemptInfo: () => getLoginAttemptInfo<AgentaPasswordlessAttempt>(),
            clearLoginAttemptInfo,
            onError: (err) => console.error("Failed to sync passwordless login attempt:", err),
        })
        return attempt.status === "resume" ? {email: attempt.email} : null
    }, [])

    // Entry → methods → code, discovery and its cancellation, the returning-visitor promotion:
    // all of it is @agenta/auth-ui's, shared with /m. This page supplies only what it alone
    // owns — the desktop's registered OIDC redirect, its invite store, its backend-down test.
    const flow = useSignInFlow({
        query: router.query,
        startThirdParty: async (thirdPartyId) => {
            const callbackUrl = `${getAgentaWebUrl()}/auth/callback/${thirdPartyId}`
            const authUrl = await getAuthorisationURLWithQueryParamsAndSetState({
                thirdPartyId,
                frontendRedirectURI: callbackUrl,
                redirectURIOnProviderDashboard: callbackUrl,
            })
            window.location.href = authUrl
        },
        onInvite: (parsed) => {
            if (Object.keys(invite).length === 0) setInvite(parsed)
        },
        isBackendDown: isBackendAvailabilityIssue,
        resumeCodeAttempt: isPasswordlessDemo ? resumeCodeAttempt : undefined,
    })
    const {entry, methods, message, setMessage, reportError: authErrorMsg} = flow
    const isLoginCodeVisible = flow.stage === "code"
    const isAuthLoading = flow.discovering
    const isInitialOtpCheckLoading = flow.restoring

    const emailFromQuery = firstQueryValue(router.query.email)
    const authError = firstQueryValue(router.query.auth_error)
    const {redirectToPath, ...queries} = router.query
    const isInvitedUser = Object.keys(queries.token ? queries : invite).length > 0

    // For auth upgrade scenarios - check if user has other orgs they can access
    const isAuthenticated = useAtomValue(sessionExistsAtom)
    const orgs = useAtomValue(orgsAtom)
    const {user} = useProfileData()
    const isAuthUpgradeRequired = authError === "upgrade_required"
    const authMessage = firstQueryValue(router.query.auth_message)
    const organizationId = firstQueryValue(router.query.organization_id)

    // Check if there's an invite email mismatch
    const inviteEmail = emailFromQuery?.toLowerCase()
    const currentUserEmail = user?.email?.toLowerCase()
    const hasInviteEmailMismatch =
        isAuthenticated && inviteEmail && currentUserEmail && inviteEmail !== currentUserEmail

    // Derived state: whether to show the normal auth flow (not blocked by special states)
    // Note: We still show auth methods when isAuthUpgradeRequired because the user needs
    // to re-authenticate with the required method. Only hide for invite email mismatch.
    const shouldShowNormalAuthFlow = !hasInviteEmailMismatch

    // When auth upgrade is required, we show social auth but hide email-based flows
    // since the user needs to authenticate with a different method (social/SSO)
    const shouldShowEmailFlow = shouldShowNormalAuthFlow && !isAuthUpgradeRequired

    // Filter out the current org that requires upgrade - user can navigate to other orgs
    const otherOrgs = useMemo(() => {
        if (!orgs || !Array.isArray(orgs)) return []
        // Filter out the org that triggered the upgrade requirement
        return orgs.filter((org) => org.id !== organizationId)
    }, [orgs, organizationId])

    // Memoize select options to prevent re-renders
    const orgSelectOptions = useMemo(
        () => otherOrgs.map((org) => ({label: org.name, value: org.id})),
        [otherOrgs],
    )

    // The package lists the providers a deployment configured; the icons are this app's.
    const promotedProvider = entry.promotedProvider
        ? withProviderIcon(entry.promotedProvider)
        : undefined
    const otherProviders = entry.otherProviders.map(withProviderIcon)
    const socialAvailable = entry.providers.length > 0
    const showEmailEntry = entry.showEmailEntry
    const isReturningEmail = entry.promotedEmail
    const ssoProviders = methods.sso
    const ssoAvailable = ssoProviders.length > 0
    const emailPasswordAvailable = methods.password
    const emailOtpAvailable = methods.otp
    const heading = entry.heading
    const isReturning = entry.isReturning
    // Optional deploy-time display font for the headlines; Inter when unset.
    const displayFontUrl = getDisplayFontUrl()
    // Pre-discovery entry screen; gated on the normal flow so auth-upgrade still shows social buttons.
    const showEntryScreen = shouldShowNormalAuthFlow && flow.stage === "entry"

    // Frame, method column and marketing panel come from @agenta/auth-ui, so this page and /m
    // render the same sign-in rather than two copies of it.
    return (
        <AuthShell
            displayFontUrl={displayFontUrl}
            header={
                /* eslint-disable-next-line @next/next/no-img-element -- local SVG logo, no optimization needed */
                <img
                    src={
                        isDark
                            ? "/assets/logos/Agenta-logo-full-dark.svg"
                            : "/assets/logos/Agenta-logo-full-light.svg"
                    }
                    alt="Agenta"
                    className="h-[23px] w-auto"
                />
            }
            overlay={
                message.type && message.type !== "error" ? (
                    <Alert
                        showIcon
                        closable
                        message={message.message}
                        type={message.type}
                        className="absolute bottom-6 right-6"
                    />
                ) : null
            }
        >
            <div className="flex flex-col gap-1">
                <h1 className="auth-headline auth-headline-form">{heading}</h1>
                {!isReturning && <p className="auth-subline">Sign in or create an account.</p>}
            </div>

            <div className="flex flex-col gap-[22px]">
                {shouldShowRegionSelector() && <RegionSelector />}
                {/* Show invite email mismatch message */}
                {hasInviteEmailMismatch && (
                    <div className="flex flex-col gap-4">
                        <Alert
                            showIcon
                            message="Signed in with a different account"
                            description={`This invitation was sent to ${inviteEmail}, but you're currently signed in as ${currentUserEmail}. Please sign out and sign in with the correct account to accept this invitation.`}
                            type="warning"
                        />
                        <div className="flex gap-3 justify-center">
                            <Button onClick={() => router.replace("/w")}>
                                Go to your organizations
                            </Button>
                            <Button
                                type="primary"
                                onClick={() => {
                                    signOut()
                                        .then(() => {
                                            // Stay on current page with invite params
                                            router.replace(router.asPath)
                                        })
                                        .catch(console.error)
                                }}
                            >
                                Sign out
                            </Button>
                        </div>
                    </div>
                )}

                {/* Show auth upgrade required message prominently */}
                {isAuthUpgradeRequired && authMessage && !hasInviteEmailMismatch && (
                    <Alert
                        showIcon
                        message="Additional authentication required"
                        description={authMessage}
                        type="warning"
                    />
                )}

                {/* Entry screen — residency + methods, ordered by the returning
                            state (design frames 2a / 2b / 3a). */}
                {showEntryScreen && (
                    <>
                        {/* 2b: last-used provider promoted (yellow keycap) */}
                        {promotedProvider && (
                            <>
                                <SocialAuth
                                    authErrorMsg={authErrorMsg}
                                    disabled={isAuthLoading || isInitialOtpCheckLoading}
                                    isLoading={isSocialAuthLoading}
                                    setIsLoading={setIsSocialAuthLoading}
                                    providers={[promotedProvider]}
                                    variant="promoted"
                                    yellow
                                    lastUsedProviderId={promotedProvider.id}
                                />
                                {(otherProviders.length > 0 ||
                                    (showEmailEntry && shouldShowEmailFlow)) && (
                                    <div className="auth-divider">or</div>
                                )}
                            </>
                        )}

                        {/* 3a: last-used email promoted (yellow keycap) */}
                        {isReturningEmail && shouldShowEmailFlow && (
                            <>
                                <EmailFirst
                                    email={flow.email}
                                    setEmail={flow.setEmail}
                                    onContinue={flow.continueWithEmail}
                                    message={message}
                                    disabled={isSocialAuthLoading || isInitialOtpCheckLoading}
                                    promoted
                                    primary
                                />
                                {socialAvailable && <div className="auth-divider">or</div>}
                            </>
                        )}

                        {/* Providers list (2a: all; 2b: the rest; 3a: all) */}
                        {socialAvailable && otherProviders.length > 0 && (
                            <SocialAuth
                                authErrorMsg={authErrorMsg}
                                disabled={isAuthLoading || isInitialOtpCheckLoading}
                                isLoading={isSocialAuthLoading}
                                setIsLoading={setIsSocialAuthLoading}
                                providers={otherProviders}
                            />
                        )}

                        {/* Email entry (2a: yellow after providers; 2b: neutral).
                                    3a already shows email promoted above. */}
                        {showEmailEntry && !isReturningEmail && shouldShowEmailFlow && (
                            <>
                                {socialAvailable && !promotedProvider && (
                                    <div className="auth-divider">or</div>
                                )}
                                <EmailFirst
                                    email={flow.email}
                                    setEmail={flow.setEmail}
                                    onContinue={flow.continueWithEmail}
                                    message={message}
                                    disabled={isSocialAuthLoading || isInitialOtpCheckLoading}
                                    primary={!promotedProvider}
                                />
                            </>
                        )}
                    </>
                )}

                {/* Step 3: After email discovery, show available methods */}
                {flow.stage !== "entry" && shouldShowEmailFlow && (
                    <>
                        {/* Show OTP flow if available */}
                        {emailOtpAvailable && !isLoginCodeVisible && (
                            <PasswordlessAuth
                                email={flow.email}
                                setEmail={flow.setEmail}
                                message={message}
                                setMessage={setMessage}
                                authErrorMsg={authErrorMsg}
                                setIsLoginCodeVisible={flow.setCodeSent}
                                disabled={isSocialAuthLoading || isInitialOtpCheckLoading}
                                lockEmail
                            />
                        )}

                        {/* Show password field if available */}
                        {emailPasswordAvailable && !isLoginCodeVisible && (
                            <EmailPasswordAuth
                                message={message}
                                setMessage={setMessage}
                                authErrorMsg={authErrorMsg}
                                initialEmail={flow.email}
                                lockEmail
                            />
                        )}

                        {/* Show OTP input if OTP was sent */}
                        {emailOtpAvailable && isLoginCodeVisible && (
                            <SendOTP
                                message={message}
                                email={flow.email}
                                setMessage={setMessage}
                                authErrorMsg={authErrorMsg}
                                setIsLoginCodeVisible={flow.setCodeSent}
                                isInvitedUser={isInvitedUser}
                            />
                        )}

                        {(emailPasswordAvailable || emailOtpAvailable) && ssoAvailable && (
                            <div className="auth-divider">or</div>
                        )}

                        {ssoAvailable && (
                            <div className="flex flex-col gap-2">
                                {ssoProviders.map((provider) => (
                                    <Button
                                        key={provider.id}
                                        size="large"
                                        className="w-full"
                                        onClick={() => void flow.startSso(provider)}
                                        loading={isSocialAuthLoading || flow.redirecting}
                                        disabled={isAuthLoading || isInitialOtpCheckLoading}
                                    >
                                        Continue with SSO ({provider.label})
                                    </Button>
                                ))}
                            </div>
                        )}

                        {/* Show back button to change email */}
                        {!isLoginCodeVisible && (
                            <Button
                                type="link"
                                onClick={flow.useDifferentEmail}
                                className="text-center w-full"
                            >
                                Use a different email
                            </Button>
                        )}
                    </>
                )}

                {/* Auth upgrade: show organization switch and sign out options */}
                {isAuthUpgradeRequired && isAuthenticated && !hasInviteEmailMismatch && (
                    <div className="flex flex-col gap-3 pt-2 border-t border-[var(--ag-c-E5E7EB)]">
                        {otherOrgs.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <Text className="text-sm text-[var(--ag-c-586673)]">
                                    Or switch to a different organization:
                                </Text>
                                <Select
                                    placeholder="Select an organization"
                                    className="w-full"
                                    options={orgSelectOptions}
                                    onChange={(value) => {
                                        router.replace(`/w/${value}`)
                                    }}
                                />
                            </div>
                        )}
                        <Button
                            type="link"
                            className="text-center p-0"
                            onClick={() => {
                                // Clear auth upgrade state before signing out
                                if (typeof window !== "undefined") {
                                    window.localStorage.removeItem("authUpgradeOrgId")
                                }
                                signOut()
                                    .then(() => {
                                        // Clear auth error params to avoid showing stale error message
                                        router.replace("/auth")
                                    })
                                    .catch(console.error)
                            }}
                        >
                            Sign out and use a different account
                        </Button>
                    </div>
                )}
            </div>

            {isDemo() && !isLoginCodeVisible && shouldShowNormalAuthFlow && (
                <p className="auth-terms">
                    By continuing, you agree to Agenta's{" "}
                    <a
                        target="_blank"
                        rel="noopener noreferrer"
                        href="https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7"
                    >
                        Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                        target="_blank"
                        rel="noopener noreferrer"
                        href="https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59"
                    >
                        Privacy Policy
                    </a>
                    .
                </p>
            )}
        </AuthShell>
    )
}

export default () => (
    <ProtectedRoute>
        <Auth />
    </ProtectedRoute>
)
