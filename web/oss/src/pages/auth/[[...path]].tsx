import {useEffect, useMemo, useRef, useState} from "react"

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
import {Alert, Button, Divider, Select, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Image from "next/image"
import {useRouter} from "next/router"
import {getLoginAttemptInfo} from "supertokens-auth-react/recipe/passwordless"
import {signOut} from "supertokens-auth-react/recipe/session"
import {getAuthorisationURLWithQueryParamsAndSetState} from "supertokens-auth-react/recipe/thirdparty"
import {useLocalStorage} from "usehooks-ts"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {getEffectiveAuthConfig} from "@/oss/lib/helpers/dynamicEnv"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {shouldShowRegionSelector} from "@/oss/lib/helpers/region"
import {isDemo} from "@/oss/lib/helpers/utils"
import {AuthErrorMsgType} from "@/oss/lib/Types"
import {orgsAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {sessionExistsAtom} from "@/oss/state/session"

const PasswordlessAuth = dynamic(() => import("@/oss/components/pages/auth/PasswordlessAuth"))
const EmailPasswordAuth = dynamic(() => import("@/oss/components/pages/auth/EmailPasswordAuth"))
const EmailFirst = dynamic(() => import("@/oss/components/pages/auth/EmailFirst"))
const SocialAuth = dynamic(() => import("@/oss/components/pages/auth/SocialAuth"), {ssr: false})
const SendOTP = dynamic(() => import("@/oss/components/pages/auth/SendOTP"), {ssr: false})
const SideBanner = dynamic(() => import("@/oss/components/pages/auth/SideBanner"), {ssr: false})
const RegionSelector = dynamic(() => import("@/oss/components/pages/auth/RegionSelector"), {
    ssr: false,
})

const {Text, Title} = Typography
const LAST_SSO_ORG_SLUG_KEY = "lastSsoOrgSlug"

const Auth = () => {
    const [isAuthLoading, setIsAuthLoading] = useState(false)
    const [isSocialAuthLoading, setIsSocialAuthLoading] = useState(false)
    const [isLoginCodeVisible, setIsLoginCodeVisible] = useState(false)
    const [message, setMessage] = useState<AuthErrorMsgType>({} as AuthErrorMsgType)
    const [showEmailForm, setShowEmailForm] = useState(true)
    const discoveryInProgress = useRef(false)
    const discoveryAbortRef = useRef<AbortController | null>(null)
    const ssoRedirectInFlight = useRef(false)
    const [availableMethods, setAvailableMethods] = useState<{
        "email:password"?: boolean
        "email:otp"?: boolean
        "social:google"?: boolean
        "social:google-workspaces"?: boolean
        "social:github"?: boolean
        "social:facebook"?: boolean
        "social:apple"?: boolean
        "social:discord"?: boolean
        "social:twitter"?: boolean
        "social:gitlab"?: boolean
        "social:bitbucket"?: boolean
        "social:linkedin"?: boolean
        "social:okta"?: boolean
        "social:azure-ad"?: boolean
        "social:boxy-saml"?: boolean
        sso?: {providers: {id: string; slug: string; third_party_id?: string}[]}
    }>({})
    const [discoveryComplete, setDiscoveryComplete] = useState(false)
    const [invite, setInvite] = useLocalStorage("invite", {})
    const router = useRouter()
    const {authnEmail, authEmailEnabled, authOidcEnabled, oidcProviders} = getEffectiveAuthConfig()
    const isPasswordlessDemo = isDemo() && authnEmail === "otp"
    const showEmailEntry = authEmailEnabled || authOidcEnabled

    const firstString = (value: string | string[] | undefined): string | undefined => {
        if (Array.isArray(value)) return value[0]
        return typeof value === "string" ? value : undefined
    }

    const token = firstString(router.query.token)
    const organizationId = firstString(router.query.organization_id)
    const projectId = firstString(router.query.project_id)
    const workspaceId = firstString(router.query.workspace_id)
    const emailFromQuery = firstString(router.query.email)
    const authMessage = firstString(router.query.auth_message)
    const authError = firstString(router.query.auth_error)
    const {redirectToPath, ...queries} = router.query
    const isInvitedUser = Object.keys(queries.token ? queries : invite).length > 0

    // For auth upgrade scenarios - check if user has other orgs they can access
    const isAuthenticated = useAtomValue(sessionExistsAtom)
    const orgs = useAtomValue(orgsAtom)
    const {user} = useProfileData()
    const isAuthUpgradeRequired = authError === "upgrade_required"

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

    const [email, setEmail] = useState(emailFromQuery ?? "")
    const [emailSubmitted, setEmailSubmitted] = useState(!!emailFromQuery)

    useEffect(() => {
        if (isInvitedUser && Object.keys(invite).length === 0) {
            setInvite({
                token,
                organization_id: organizationId,
                project_id: projectId,
                workspace_id: workspaceId,
                email: emailFromQuery,
            })
        }
    }, [
        isInvitedUser,
        invite,
        setInvite,
        token,
        organizationId,
        projectId,
        workspaceId,
        emailFromQuery,
    ])

    useEffect(() => {
        if (authMessage) {
            setMessage({
                message: authMessage,
                type: authError === "sso_denied" ? "info" : "error",
            })
        }
    }, [authMessage, authError])

    const authErrorMsg = (error: any) => {
        if (error.isSuperTokensGeneralError === true) {
            // this may be a custom error message sent from the API by you.
            setMessage({message: error.message, type: "error"})
        } else if (isBackendAvailabilityIssue(error)) {
            setMessage({
                message: "Unable to connect to the authentication service",
                sub: "Please check if the backend is running and accessible. If you're self-hosting, ensure all services are started properly.",
                type: "error",
            })
        } else {
            setMessage({
                message: "Oops, something went wrong. Please try again",
                sub: "If the issue persists, please contact support",
                type: "error",
            })
        }
    }

    const hasInitialOTPBeenSent = async () => {
        if (!isPasswordlessDemo) return
        const hasEmailSended = (await getLoginAttemptInfo()) !== undefined
        if (hasEmailSended) {
            setIsLoginCodeVisible(true)
        } else {
            setIsLoginCodeVisible(false)
        }
    }

    const parseSsoOrgSlug = (thirdPartyId?: string): string | null => {
        if (!thirdPartyId) return null
        if (!thirdPartyId.startsWith("sso:")) return null
        const [, orgSlug] = thirdPartyId.split(":")
        return orgSlug || null
    }

    const formatSsoProviderLabel = (provider: {slug: string; third_party_id?: string}) => {
        const suffix = provider.third_party_id?.startsWith("sso:")
            ? provider.third_party_id.replace(/^sso:/, "")
            : provider.slug
        return suffix
    }

    const redirectToSsoProvider = async (provider: {
        id: string
        slug: string
        third_party_id?: string
    }) => {
        if (isSocialAuthLoading || ssoRedirectInFlight.current) return
        ssoRedirectInFlight.current = true
        setIsSocialAuthLoading(true)

        try {
            if (!provider.third_party_id) {
                throw new Error("SSO provider is missing a third_party_id")
            }

            // Store the org slug so the post-auth redirect can land in the SSO org,
            // not Personal, after the callback completes.
            const orgSlug = parseSsoOrgSlug(provider.third_party_id)
            if (orgSlug && typeof window !== "undefined") {
                window.localStorage.setItem(LAST_SSO_ORG_SLUG_KEY, orgSlug)
            }

            const callbackUrl = `${getAgentaWebUrl()}/auth/callback/${provider.third_party_id}`
            const authUrl = await getAuthorisationURLWithQueryParamsAndSetState({
                thirdPartyId: provider.third_party_id,
                frontendRedirectURI: callbackUrl,
                redirectURIOnProviderDashboard: callbackUrl,
            })

            window.location.href = authUrl
        } catch (err) {
            ssoRedirectInFlight.current = false
            setIsSocialAuthLoading(false)
            authErrorMsg(err)
        }
    }

    useEffect(() => {
        if (isPasswordlessDemo) {
            hasInitialOTPBeenSent()
        }
    }, [])

    useEffect(() => {
        return () => {
            discoveryAbortRef.current?.abort()
        }
    }, [])

    // Discover available auth methods after email is submitted
    const handleEmailDiscovery = async (emailToDiscover: string) => {
        // Prevent duplicate calls
        if (discoveryInProgress.current) {
            console.warn("⚠️ Discovery already in progress, aborting previous request...")
            discoveryAbortRef.current?.abort()
            discoveryInProgress.current = false
        }

        // Only probe discover if either auth path is configured
        if (!authEmailEnabled && !authOidcEnabled) {
            console.warn(
                "⚠️ Both authEmailEnabled and authOidcEnabled are false - no auth methods available!",
            )
            setMessage({
                message: "No authentication methods are configured",
                type: "error",
            })
            return
        }

        try {
            discoveryInProgress.current = true
            setIsAuthLoading(true)

            discoveryAbortRef.current?.abort()
            const controller = new AbortController()
            discoveryAbortRef.current = controller

            const {data} = await axios.post(
                `${getAgentaApiUrl()}/auth/discover`,
                {
                    email: emailToDiscover,
                },
                {
                    signal: controller.signal,
                },
            )

            if (data?.methods) {
                setAvailableMethods(data.methods)
                setDiscoveryComplete(true)
                setEmailSubmitted(true)

                // Check if only SSO is available and auto-redirect
                const methods = data.methods
                const ssoProviders = Array.isArray(methods.sso?.providers)
                    ? methods.sso.providers
                    : []
                const ssoMethods = Object.keys(methods).filter(
                    (key) => key.startsWith("social:") && methods[key] === true,
                )
                const hasSSOOnly =
                    ssoProviders.length > 0 &&
                    methods["email:password"] === false &&
                    methods["email:otp"] === false &&
                    ssoMethods.length === 0

                if (hasSSOOnly && ssoProviders.length === 1) {
                    await redirectToSsoProvider(ssoProviders[0])
                }
            } else {
                console.warn("⚠️ No methods in discovery response")
                setDiscoveryComplete(true)
                setEmailSubmitted(true)
            }
        } catch (err) {
            const isCanceled =
                axios.isCancel?.(err) ||
                (err as {code?: string}).code === "ERR_CANCELED" ||
                (err instanceof Error &&
                    (err.name === "AbortError" ||
                        err.name === "CanceledError" ||
                        err.message === "canceled"))

            if (isCanceled) {
                return
            }

            console.error("❌ Failed to fetch auth discover info:", err)
            if (err instanceof Error) {
                setDiscoveryComplete(true)
                setEmailSubmitted(true)
                authErrorMsg(err)
            }
        } finally {
            discoveryInProgress.current = false
            setIsAuthLoading(false)
        }
    }

    const handleEmailContinue = async (emailValue: string) => {
        setEmail(emailValue)
        setMessage({} as AuthErrorMsgType)
        await handleEmailDiscovery(emailValue)
    }

    // Auto-discover if email comes from query params
    useEffect(() => {
        if (emailFromQuery && !discoveryComplete) {
            handleEmailDiscovery(emailFromQuery)
        }
    }, [emailFromQuery])

    const oidcProviderMeta = [
        {id: "google", label: "Google", icon: <GoogleOutlined />},
        {id: "google-workspaces", label: "Google Workspaces", icon: <GoogleOutlined />},
        {id: "github", label: "GitHub", icon: <GithubOutlined />},
        {id: "facebook", label: "Facebook", icon: <FacebookOutlined />},
        {id: "apple", label: "Apple", icon: <AppleOutlined />},
        {id: "discord", label: "Discord", icon: <GlobalOutlined />},
        {id: "twitter", label: "X", icon: <TwitterOutlined />},
        {id: "gitlab", label: "GitLab", icon: <GlobalOutlined />},
        {id: "bitbucket", label: "Bitbucket", icon: <GlobalOutlined />},
        {id: "linkedin", label: "LinkedIn", icon: <LinkedinOutlined />},
        {id: "okta", label: "Okta", icon: <GlobalOutlined />},
        {id: "azure-ad", label: "Azure AD", icon: <GlobalOutlined />},
        {id: "boxy-saml", label: "SAML", icon: <GlobalOutlined />},
    ]

    const configuredProviderIds = new Set(oidcProviders.map((provider) => provider.id))
    const providersToShow = oidcProviderMeta.filter((provider) =>
        configuredProviderIds.has(provider.id),
    )

    const socialAvailable = authOidcEnabled && providersToShow.length > 0
    const ssoProviders = Array.isArray(availableMethods.sso?.providers)
        ? availableMethods.sso.providers
        : []
    const ssoAvailable = ssoProviders.length > 0
    const ssoProvidersToShow = ssoProviders.map((provider) => ({
        ...provider,
    }))

    // After discovery, check what's actually available
    const emailPasswordAvailable = discoveryComplete && authEmailEnabled && authnEmail !== "otp"

    const emailOtpAvailable = discoveryComplete && authEmailEnabled && authnEmail === "otp"

    useLazyEffect(() => {
        if (message.message && message.type !== "error") {
            setTimeout(() => {
                setMessage({} as AuthErrorMsgType)
            }, 5000)
        }
    }, [message])

    useEffect(() => {
        if (emailSubmitted) {
            setMessage({} as AuthErrorMsgType)
        }
    }, [emailSubmitted])

    useEffect(() => {
        if (!socialAvailable && !emailSubmitted) {
            setShowEmailForm(true)
        }
    }, [emailSubmitted, socialAvailable])

    return (
        <main
            className={clsx([
                "w-screen h-screen flex items-center",
                "justify-center lg:justify-normal",
            ])}
        >
            <section
                className={clsx(
                    "h-screen flex items-center justify-center rounded-tr-[1.5rem] rounded-br-[1.5rem] shadow-[15px_0px_80px_0px_rgba(214,222,230,0.5)]",
                    "w-full lg:w-1/2",
                    "px-4 lg:px-0",
                )}
            >
                <Image
                    src="/assets/Agenta-logo-full-light.png"
                    alt="agenta-ai"
                    width={114}
                    height={39}
                    className={clsx(["absolute", "top-4 lg:top-14", "left-4 lg:left-14"])}
                />
                <div className="w-full max-w-[400px] flex flex-col justify-start gap-8 mx-auto">
                    <div>
                        <Title level={2} className="font-bold">
                            Welcome to Agenta AI
                        </Title>
                        <Text className="text-sm text-[#586673]">
                            Your All-In-One LLM Development Platform. Collaborate on prompts,
                            evaluate, and monitor LLM apps with confidence
                        </Text>
                    </div>

                    {!isDemo() && (
                        <Alert
                            message={
                                <div className="space-y-1 italic">
                                    <p className="m-0">
                                        If you are the first member to log in, your account will
                                        become the organization{" "}
                                        <span className="font-bold">owner</span>. As an{" "}
                                        <span className="font-bold">owner</span>, you will have
                                        exclusive rights to invite other members to your
                                        organization.
                                    </p>
                                    <p className="m-0">
                                        If you are not the first member to join, please contact the{" "}
                                        <span className="font-bold">owner</span> and request an
                                        invitation.
                                    </p>
                                </div>
                            }
                        />
                    )}

                    <div className="flex flex-col gap-6 min-h-[360px]">
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

                        {/* Step 1: Show social auth options (if configured) */}
                        {socialAvailable && shouldShowNormalAuthFlow && (
                            <>
                                <SocialAuth
                                    authErrorMsg={authErrorMsg}
                                    disabled={isAuthLoading}
                                    isLoading={isSocialAuthLoading}
                                    setIsLoading={setIsSocialAuthLoading}
                                    providers={providersToShow}
                                />
                                {showEmailEntry && shouldShowEmailFlow && (
                                    <Divider className="!m-0">or</Divider>
                                )}
                            </>
                        )}

                        {/* Step 2: Email-first (if email auth is enabled and email not yet submitted) */}
                        {showEmailEntry &&
                            !emailSubmitted &&
                            !socialAvailable &&
                            !isLoginCodeVisible &&
                            shouldShowEmailFlow && (
                                <EmailFirst
                                    email={email}
                                    setEmail={setEmail}
                                    onContinue={handleEmailContinue}
                                    message={message}
                                    disabled={isSocialAuthLoading}
                                />
                            )}

                        {showEmailEntry &&
                            !emailSubmitted &&
                            socialAvailable &&
                            !showEmailForm &&
                            shouldShowEmailFlow && (
                                <Button
                                    type="link"
                                    onClick={() => setShowEmailForm(true)}
                                    className="text-center w-full"
                                >
                                    Use a different email
                                </Button>
                            )}

                        {showEmailEntry &&
                            !emailSubmitted &&
                            socialAvailable &&
                            showEmailForm &&
                            !isLoginCodeVisible &&
                            shouldShowEmailFlow && (
                                <EmailFirst
                                    email={email}
                                    setEmail={setEmail}
                                    onContinue={handleEmailContinue}
                                    message={message}
                                    disabled={isSocialAuthLoading}
                                />
                            )}

                        {/* Step 3: After email discovery, show available methods */}
                        {emailSubmitted && discoveryComplete && shouldShowEmailFlow && (
                            <>
                                {/* Show OTP flow if available */}
                                {emailOtpAvailable && !isLoginCodeVisible && (
                                    <PasswordlessAuth
                                        email={email}
                                        setEmail={setEmail}
                                        isLoading={isAuthLoading}
                                        message={message}
                                        setIsLoading={setIsAuthLoading}
                                        setMessage={setMessage}
                                        authErrorMsg={authErrorMsg}
                                        setIsLoginCodeVisible={setIsLoginCodeVisible}
                                        disabled={isSocialAuthLoading}
                                        lockEmail
                                    />
                                )}

                                {/* Show password field if available */}
                                {emailPasswordAvailable && !isLoginCodeVisible && (
                                    <EmailPasswordAuth
                                        message={message}
                                        setMessage={setMessage}
                                        authErrorMsg={authErrorMsg}
                                        initialEmail={email}
                                        lockEmail
                                    />
                                )}

                                {/* Show OTP input if OTP was sent */}
                                {emailOtpAvailable && isLoginCodeVisible && (
                                    <SendOTP
                                        message={message}
                                        email={email}
                                        setMessage={setMessage}
                                        authErrorMsg={authErrorMsg}
                                        setIsLoginCodeVisible={setIsLoginCodeVisible}
                                        isInvitedUser={isInvitedUser}
                                    />
                                )}

                                {(emailPasswordAvailable || emailOtpAvailable) && ssoAvailable && (
                                    <Divider className="!m-0">or</Divider>
                                )}

                                {ssoAvailable && (
                                    <div className="flex flex-col gap-2">
                                        {ssoProvidersToShow.map((provider) => (
                                            <Button
                                                key={provider.id}
                                                icon={provider.icon}
                                                size="large"
                                                className="w-full"
                                                onClick={() => redirectToSsoProvider(provider)}
                                                loading={isSocialAuthLoading}
                                                disabled={isAuthLoading}
                                            >
                                                Continue with SSO (
                                                {formatSsoProviderLabel(provider)})
                                            </Button>
                                        ))}
                                    </div>
                                )}

                                {/* Show back button to change email */}
                                {!isLoginCodeVisible && (
                                    <Button
                                        type="link"
                                        onClick={() => {
                                            setEmailSubmitted(false)
                                            setDiscoveryComplete(false)
                                            setAvailableMethods({})
                                        }}
                                        className="text-center w-full"
                                    >
                                        Use a different email
                                    </Button>
                                )}
                            </>
                        )}

                        {/* Auth upgrade: show organization switch and sign out options */}
                        {isAuthUpgradeRequired && isAuthenticated && !hasInviteEmailMismatch && (
                            <div className="flex flex-col gap-3 pt-2 border-t border-[#e5e7eb]">
                                {otherOrgs.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <Text className="text-sm text-[#586673]">
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
                        <Text>
                            By clicking on next, you agree to the Agenta AI's{" "}
                            <a
                                target="_blank"
                                rel="noopener noreferrer"
                                className="!underline !underline-offset-2"
                                href="https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7"
                            >
                                Terms of Services
                            </a>{" "}
                            and{" "}
                            <a
                                target="_blank"
                                rel="noopener noreferrer"
                                className="!underline !underline-offset-2"
                                href="https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59"
                            >
                                Privacy Policy
                            </a>
                        </Text>
                    )}
                </div>
            </section>

            <SideBanner />

            {message.type && message.type !== "error" ? (
                <Alert
                    showIcon
                    closable
                    message={message.message}
                    type={message.type}
                    className="absolute bottom-6 right-6"
                />
            ) : null}
        </main>
    )
}

export default () => (
    <ProtectedRoute>
        <Auth />
    </ProtectedRoute>
)
