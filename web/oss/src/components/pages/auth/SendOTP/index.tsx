import {useRef, useState} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Form, FormProps, Input, Typography} from "antd"
import {OTPRef} from "antd/es/input/OTP"
import {
    clearLoginAttemptInfo,
    consumeCode,
    resendCode,
} from "supertokens-auth-react/recipe/passwordless"

import ShowErrorMessage from "@/oss/components/pages/auth/assets/ShowErrorMessage"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"

import {useStyles} from "../assets/style"
import {SendOTPProps} from "../assets/types"

const {Text, Title} = Typography

const SendOTP = ({
    message,
    email,
    setMessage,
    authErrorMsg,
    setIsLoginCodeVisible,
    isInvitedUser,
}: SendOTPProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
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
            const response = await consumeCode({userInputCode: values.otp})

            if (response.status === "OK") {
                await clearLoginAttemptInfo()
                setMessage({message: "Verification successful", type: "success"})
                // Clear selected organization via atom to keep storage in sync
                const {createdNewRecipeUser, user} = response
                await handleAuthSuccess({createdNewRecipeUser, user}, {isInvitedUser})
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
            }
        } catch (err) {
            authErrorMsg(err)
        } finally {
            setIsLoading(false)
        }
    }

    const backToLogin = async () => {
        await clearLoginAttemptInfo()
        setIsLoginCodeVisible(false)
    }

    return (
        <div className="h-[680px] flex flex-col justify-center gap-10 mx-auto mt-10 w-[235px]">
            <div className="text-center gap-4">
                <Title level={2} className="font-bold">
                    Verify your email
                </Title>
                <Text>
                    A 6 digit code has been sent to{" "}
                    <span className="block font-medium">{email}</span> The code is valid for next 15
                    minutes.
                </Text>
            </div>

            <Form autoComplete="off" onFinish={submitOTP} className="w-full space-y-2">
                {message.type == "error" && <ShowErrorMessage info={message} />}

                <Form.Item
                    name="otp"
                    className={`${
                        message.type == "error" && classes.inputOTP
                    } w-full mb-2 ${classes.otpFormContainer}`}
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
                    Next
                </Button>
            </Form>

            <div className="grid gap-2 text-center">
                {isResendDisabled ? (
                    <div className="text-center *:whitespace-nowrap mb-1">
                        <Typography.Paragraph>
                            Check your email for the new code
                        </Typography.Paragraph>
                        <Text className={classes.textDisabled}>
                            Please wait to request new code (60s)
                        </Text>
                    </div>
                ) : (
                    <Text>
                        Didn’t receive the code?{" "}
                        <Button
                            type="link"
                            disabled={isResendDisabled || isLoading}
                            onClick={resendOTP}
                            className="!p-0"
                        >
                            click here
                        </Button>
                    </Text>
                )}

                <Button
                    type="link"
                    className="w-full"
                    icon={<ArrowLeft size={14} className="mt-[3px]" />}
                    onClick={backToLogin}
                >
                    Back to Login
                </Button>
            </div>
        </div>
    )
}

export default SendOTP
