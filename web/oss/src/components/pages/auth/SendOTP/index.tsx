import {useRef, useState} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Form, FormProps, Input, Typography} from "antd"
import {OTPRef} from "antd/es/input/OTP"
import {useSetAtom} from "jotai"
import {
    clearLoginAttemptInfo,
    consumeCode,
    resendCode,
} from "supertokens-auth-react/recipe/passwordless"

import ShowErrorMessage from "@/oss/components/pages/auth/assets/ShowErrorMessage"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {authFlowAtom} from "@/oss/state/session"

import {useStyles} from "../assets/style"
import {SendOTPProps} from "../assets/types"

const {Text} = Typography

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
    const classes = useStyles()
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
                setMessage({message: "Verification successful", type: "success"})
                // Clear selected org via atom to keep storage in sync
                const {createdNewRecipeUser: _createdNewRecipeUser, user} = response
                await handleAuthSuccess({createdNewRecipeUser: true, user}, {isInvitedUser})
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
        setIsLoginCodeVisible(false)
    }

    return (
        <div className="w-full">
            <Form
                autoComplete="off"
                onFinish={submitOTP}
                className="w-full flex flex-col gap-4"
                initialValues={{email}}
            >
                {message.type == "error" && <ShowErrorMessage info={message} />}

                <Form.Item name="email" className="w-full mb-0 flex flex-col gap-1">
                    <Input
                        size="large"
                        type="email"
                        value={email}
                        placeholder="Enter valid email address"
                        disabled
                        className="auth-locked-input"
                    />
                </Form.Item>

                <Form.Item
                    name="otp"
                    className={`${
                        message.type == "error" && classes.inputOTP
                    } w-full mb-0 ${classes.otpFormContainer}`}
                    rules={[
                        {
                            required: true,
                            message: "Invalid OTP!",
                            min: 6,
                        },
                    ]}
                >
                    <Input.OTP
                        formatter={(str) => str.toUpperCase()}
                        autoFocus={true}
                        ref={inputRef}
                    />
                </Form.Item>

                <Button
                    size="large"
                    type="primary"
                    htmlType="submit"
                    className="w-full"
                    loading={isLoading}
                >
                    Continue with OTP
                </Button>
            </Form>

            <div className="grid gap-2 text-center mt-4">
                <Button
                    type="link"
                    className="w-full"
                    icon={<ArrowLeft size={14} className="mt-[3px]" />}
                    onClick={backToLogin}
                >
                    Use a different email
                </Button>
                <Button
                    type="link"
                    className="w-full"
                    disabled={isResendDisabled || isLoading}
                    onClick={resendOTP}
                >
                    Resend one-time password
                </Button>
                {isResendDisabled && (
                    <Text className={classes.textDisabled}>
                        Please wait to request new code (60s)
                    </Text>
                )}
            </div>
        </div>
    )
}

export default SendOTP
