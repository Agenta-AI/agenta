import {useEffect, useState} from "react"

import ProtectedRoute from "@agenta/oss/src/components/ProtectedRoute/ProtectedRoute"
import {Alert, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import Image from "next/image"
import {useRouter} from "next/router"
import {getLoginAttemptInfo} from "supertokens-auth-react/recipe/passwordless"
import {useLocalStorage} from "usehooks-ts"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {isBackendAvailabilityIssue} from "@/oss/lib/helpers/errorHandler"
import {isDemo} from "@/oss/lib/helpers/utils"
import {AuthErrorMsgType} from "@/oss/lib/Types"

const PasswordlessAuth = dynamic(() => import("@/oss/components/pages/auth/PasswordlessAuth"))
const EmailPasswordAuth = dynamic(() => import("@/oss/components/pages/auth/EmailPasswordAuth"))
const SocialAuth = dynamic(() => import("@/oss/components/pages/auth/SocialAuth"), {ssr: false})
const SendOTP = dynamic(() => import("@/oss/components/pages/auth/SendOTP"), {ssr: false})
const SideBanner = dynamic(() => import("@/oss/components/pages/auth/SideBanner"), {ssr: false})

const {Text, Title} = Typography

const Auth = () => {
    const [email, setEmail] = useState("")
    const [isAuthLoading, setIsAuthLoading] = useState(false)
    const [isSocialAuthLoading, setIsSocialAuthLoading] = useState(false)
    const [isLoginCodeVisible, setIsLoginCodeVisible] = useState(false)
    const [message, setMessage] = useState<AuthErrorMsgType>({} as AuthErrorMsgType)
    const [invite, setInvite] = useLocalStorage("invite", {})
    const router = useRouter()

    const token = router.query.token as string
    const orgId = router.query.org_id as string
    const projectId = router.query.project_id as string
    const workspaceId = router.query.workspace_id as string
    const _email = router.query.email as string
    const {redirectToPath, ...queries} = router.query
    const isInvitedUser = Object.keys(queries.token ? queries : invite).length > 0

    useEffect(() => {
        if (isInvitedUser && Object.keys(invite).length === 0) {
            setInvite({
                token,
                org_id: orgId,
                project_id: projectId,
                workspace_id: workspaceId,
                email: _email,
            })
        }
    }, [isInvitedUser, invite])

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
        const hasEmailSended = (await getLoginAttemptInfo()) !== undefined
        if (hasEmailSended) {
            setIsLoginCodeVisible(true)
        } else {
            setIsLoginCodeVisible(false)
        }
    }

    useEffect(() => {
        if (isDemo()) {
            hasInitialOTPBeenSent()
        }
    }, [])

    useLazyEffect(() => {
        if (message.message && message.type !== "error") {
            setTimeout(() => {
                setMessage({} as AuthErrorMsgType)
            }, 5000)
        }
    }, [message])

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
                    src="/assets/light-complete-transparent-CROPPED.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                    className={clsx(["absolute", "top-4 lg:top-14", "left-4 lg:left-14"])}
                />
                <div className="h-[680px] w-[400px] flex flex-col justify-center gap-8 mx-auto mt-10">
                    {!isLoginCodeVisible && (
                        <div>
                            <Title level={2} className="font-bold">
                                Welcome to Agenta AI
                            </Title>
                            <Text className="text-sm text-[#586673]">
                                Your All-In-One LLM Development Platform. Collaborate on prompts,
                                evaluate, and monitor LLM apps with confidence
                            </Text>
                        </div>
                    )}

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

                    {!isDemo() ? (
                        <EmailPasswordAuth
                            message={message}
                            setMessage={setMessage}
                            authErrorMsg={authErrorMsg}
                        />
                    ) : !isLoginCodeVisible ? (
                        <>
                            <SocialAuth
                                authErrorMsg={authErrorMsg}
                                disabled={isAuthLoading}
                                isLoading={isSocialAuthLoading}
                                setIsLoading={setIsSocialAuthLoading}
                            />
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
                            />
                        </>
                    ) : (
                        <SendOTP
                            message={message}
                            email={email}
                            setMessage={setMessage}
                            authErrorMsg={authErrorMsg}
                            setIsLoginCodeVisible={setIsLoginCodeVisible}
                            isInvitedUser={isInvitedUser}
                        />
                    )}

                    {isDemo() && !isLoginCodeVisible && (
                        <Text>
                            By clicking on next, you agree to the Agenta AI’s{" "}
                            <a
                                target="_blank"
                                className="!underline !underline-offset-2"
                                href="https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7"
                            >
                                Terms of Services
                            </a>{" "}
                            and{" "}
                            <a
                                target="_blank"
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
