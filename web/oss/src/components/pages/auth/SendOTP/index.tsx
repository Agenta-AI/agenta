import {useRef, useState} from "react"

import {clearPersistedQueryCache} from "@agenta/shared/api/persist"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Form, FormProps, Input, Typography} from "antd"
import {OTPRef} from "antd/es/input/OTP"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {authFlowAtom} from "@/oss/state/session"

import {SendOTPProps} from "../assets/types"

/** OSS binding: the package owns the step; redirect + auth-flow gating stay app-side. */
const SendOTP = ({
    message,
    email,
    setMessage,
    authErrorMsg,
    setIsLoginCodeVisible,
    isInvitedUser,
}: SendOTPProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
    const setAuthFlow = useSetAtom(authFlowAtom)
    const [isResendDisabled, setIsResendDisabled] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

    const inputRef = useRef<OTPRef>(null)

    // Listens for the window gaining focus (e.g., user returns to tab) and focuses the OTP input
    useLazyEffect(() => {
        const handleFocus = () => {
            inputRef.current?.focus()
        }
        window.addEventListener("focus", handleFocus)

        return () => {
            window.removeEventListener("focus", handleFocus)
        }
    }, [])

    const resendOTP = async () => {
        try {
            const response = await resendCode()

            if (response.status === "RESTART_FLOW_ERROR") {
                setMessage({
                    message: "Resend OTP failed. Please try again",
                    type: "error",
                })
                await clearLoginAttemptInfo()
                setIsLoginCodeVisible(false)
            } else {
                setMessage({
                    message: "New code sent successfully",
                    type: "info",
                })
                // Disable the resend button for 1 minute
                setIsResendDisabled(true)
                setTimeout(() => {
                    setIsResendDisabled(false)
                }, 60000)
            }
        } catch (err) {
            authErrorMsg(err)
        }
    }

    const submitOTP: FormProps<{otp: string}>["onFinish"] = async (values) => {
        try {
            setIsLoading(true)
            setAuthFlow("authing")
            const response = await consumeCode({userInputCode: values.otp})

            if (response.status === "OK") {
                await clearLoginAttemptInfo()
                await clearPersistedQueryCache()
                setMessage({message: "Verification successful", type: "success"})
                // Clear selected org via atom to keep storage in sync
                const {createdNewRecipeUser: _createdNewRecipeUser, user} = response
                await handleAuthSuccess(
                    {createdNewRecipeUser: true, user},
                    {isInvitedUser, authMethod: "email"},
                )
            } else if (response.status === "INCORRECT_USER_INPUT_CODE_ERROR") {
                const trileLeft =
                    response.maximumCodeInputAttempts - response.failedCodeInputAttemptCount
                setMessage({
                    message: "Invalid code, Please try again.",
                    sub: `Retry available  ${trileLeft}`,
                    type: "error",
                })
            } else if (response.status === "EXPIRED_USER_INPUT_CODE_ERROR") {
                setMessage({
                    message: "Your code has expried",
                    sub: "Please request for a new code below",
                    type: "error",
                })
            } else {
                setMessage({
                    message: "Authentication failed. Please try again",
                    type: "error",
                })
                await clearLoginAttemptInfo()
                setIsLoginCodeVisible(false)
                setAuthFlow("unauthed")
            }
        } catch (err) {
            authErrorMsg(err)
            setAuthFlow("unauthed")
        } finally {
            setIsLoading(false)
        }
    }

    const backToLogin = async () => {
        await clearLoginAttemptInfo()
        await clearPersistedQueryCache()
        setIsLoginCodeVisible(false)
    }

    return (
        <OtpVerifyForm
            email={email}
            message={message}
            setMessage={setMessage}
            onSubmitStart={() => setAuthFlow("authing")}
            onFail={() => setAuthFlow("unauthed")}
            onSuccess={async (payload) => {
                await handleAuthSuccess(
                    {createdNewRecipeUser: payload.createdNewRecipeUser, user: payload.user},
                    {isInvitedUser, authMethod: "email"},
                )
            }}
            onRestart={() => setIsLoginCodeVisible(false)}
            onAuthError={authErrorMsg}
        />
    )
}

export default SendOTP
