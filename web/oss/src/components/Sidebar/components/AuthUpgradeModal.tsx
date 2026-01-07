import {useMemo, useState} from "react"

import {
    AppleOutlined,
    FacebookOutlined,
    GithubOutlined,
    GoogleOutlined,
    LinkedinOutlined,
    TwitterOutlined,
    GlobalOutlined,
} from "@ant-design/icons"
import {Alert, Divider, Modal, Typography} from "antd"

import EmailPasswordSignIn from "@/oss/components/pages/auth/EmailPasswordSignIn"
import PasswordlessAuth from "@/oss/components/pages/auth/PasswordlessAuth"
import SendOTP from "@/oss/components/pages/auth/SendOTP"
import SocialAuth from "@/oss/components/pages/auth/SocialAuth"
import {getEffectiveAuthConfig} from "@/oss/lib/helpers/dynamicEnv"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {AuthErrorMsgType} from "@/oss/lib/Types"
import {useProfileData} from "@/oss/state/profile"

const {Text} = Typography

export interface AuthUpgradeDetail {
    message?: string
    required_methods?: string[]
    session_identities?: string[]
    user_identities?: string[]
}

interface AuthUpgradeModalProps {
    open: boolean
    organizationName?: string
    detail?: AuthUpgradeDetail | null
    onCancel: () => void
}

const AuthUpgradeModal = ({open, organizationName, detail, onCancel}: AuthUpgradeModalProps) => {
    const {user} = useProfileData()
    const {authnEmail, authEmailEnabled, authOidcEnabled, oidcProviders} = getEffectiveAuthConfig()
    const [message, setMessage] = useState<AuthErrorMsgType>({} as AuthErrorMsgType)
    const [isLoading, setIsLoading] = useState(false)
    const [isSocialAuthLoading, setIsSocialAuthLoading] = useState(false)
    const [isLoginCodeVisible, setIsLoginCodeVisible] = useState(false)
    const [email, setEmail] = useState(user?.email ?? "")

    const requiredMethods = detail?.required_methods ?? []
    const detailMessage = typeof detail?.message === "string" ? detail.message : ""
    const requiresEmail = requiredMethods.some((method) => method.startsWith("email:"))
    const requiresSocial = requiredMethods.some((method) => method.startsWith("social:"))

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

    const providersToShow = useMemo(() => {
        const configuredProviderIds = new Set(oidcProviders.map((provider) => provider.id))
        return oidcProviderMeta.filter((provider) => configuredProviderIds.has(provider.id))
    }, [oidcProviders])

    const showEmail = authEmailEnabled && (requiresEmail || requiredMethods.length === 0)
    const showSocial = authOidcEnabled && providersToShow.length > 0 && (requiresSocial || requiredMethods.length === 0)

    const authErrorMsg = (error: any) => {
        if (error.isSuperTokensGeneralError === true) {
            setMessage({message: error.message, type: "error"})
        } else if (isBackendAvailabilityIssue(error)) {
            setMessage({
                message: "Unable to connect to the authentication service",
                sub: "Please check if the backend is running and accessible.",
                type: "error",
            })
        } else {
            setMessage({
                message: "Oops, something went wrong. Please try again",
                type: "error",
            })
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onCancel}
            title="Additional authentication required"
            footer={null}
            width={520}
            destroyOnClose
        >
            <div className="flex flex-col gap-4">
                {organizationName && (
                    <Text>
                        {organizationName} requires additional authentication to continue.
                    </Text>
                )}
                {detailMessage && (
                    <Alert
                        showIcon
                        message={detailMessage}
                        type="warning"
                    />
                )}
                {showSocial && (
                    <>
                        <SocialAuth
                            authErrorMsg={authErrorMsg}
                            disabled={isLoading}
                            isLoading={isSocialAuthLoading}
                            setIsLoading={setIsSocialAuthLoading}
                            providers={providersToShow}
                        />
                        {showEmail && <Divider className="!my-2">or</Divider>}
                    </>
                )}

                {showEmail && authnEmail === "otp" && !isLoginCodeVisible && (
                    <PasswordlessAuth
                        message={message}
                        isLoading={isLoading}
                        email={email}
                        setEmail={setEmail}
                        setMessage={setMessage}
                        authErrorMsg={authErrorMsg}
                        setIsLoginCodeVisible={setIsLoginCodeVisible}
                        setIsLoading={setIsLoading}
                        disabled={false}
                        lockEmail={Boolean(user?.email)}
                    />
                )}

                {showEmail && authnEmail === "otp" && isLoginCodeVisible && (
                    <SendOTP
                        message={message}
                        email={email}
                        setMessage={setMessage}
                        authErrorMsg={authErrorMsg}
                        setIsLoginCodeVisible={setIsLoginCodeVisible}
                        isInvitedUser={false}
                    />
                )}

                {showEmail && authnEmail === "password" && (
                    <EmailPasswordSignIn
                        message={message}
                        setMessage={setMessage}
                        authErrorMsg={authErrorMsg}
                        initialEmail={email}
                        lockEmail={Boolean(user?.email)}
                    />
                )}

                {!showEmail && !showSocial && (
                    <Alert
                        showIcon
                        message="No authentication methods are configured for this organization."
                        type="warning"
                    />
                )}
            </div>
        </Modal>
    )
}

export default AuthUpgradeModal
