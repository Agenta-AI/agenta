import {useRef, useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {createCode} from "supertokens-auth-react/recipe/passwordless"

import ShowErrorMessage from "@/oss/components/pages/auth/assets/ShowErrorMessage"
import {
    clearPendingTurnstileToken,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@/oss/lib/helpers/auth/turnstile"

import {PasswordlessAuthProps} from "../assets/types"
import TurnstileWidget, {TurnstileWidgetHandle} from "../Turnstile"

const PasswordlessAuth = ({
    email,
    setEmail,
    isLoading,
    message,
    setIsLoading,
    setMessage,
    authErrorMsg,
    setIsLoginCodeVisible,
    disabled,
    lockEmail = false,
}: PasswordlessAuthProps) => {
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
    const turnstileEnabled = isTurnstileEnabled()
    const turnstileRef = useRef<TurnstileWidgetHandle>(null)

    const resetTurnstile = () => {
        clearPendingTurnstileToken()
        setTurnstileToken(null)
        turnstileRef.current?.reset()
    }

    const ensureTurnstileToken = () => {
        if (!turnstileEnabled || turnstileToken) {
            return true
        }

        setMessage({
            message: "Please complete the security check.",
            type: "error",
        })

        return false
    }

    const sendOTP: FormProps<{email: string}>["onFinish"] = async (values) => {
        if (!ensureTurnstileToken()) {
            return
        }

        try {
            setIsLoading(true)
            if (turnstileEnabled) {
                setPendingTurnstileToken(turnstileToken)
            }
            const response = await createCode({email: values.email})

            if (response.status === "SIGN_IN_UP_NOT_ALLOWED") {
                setMessage({message: response.reason, type: "error"}) // the reason string is a user friendly message
            } else {
                setMessage({
                    message: "Check your inbox for the OTP to continue!",
                    type: "success",
                })
                setIsLoginCodeVisible(true)
            }
        } catch (err) {
            authErrorMsg(err)
        } finally {
            resetTurnstile()
            setIsLoading(false)
        }
    }

    return (
        <Form className="w-full space-y-2" onFinish={sendOTP} initialValues={{email}}>
            {message.type == "error" && <ShowErrorMessage info={message} />}

            <Form.Item
                name="email"
                className="w-full mb-0"
                rules={[{required: true, message: "Please input your email!"}]}
            >
                <Input
                    size="large"
                    type="email"
                    value={email}
                    placeholder="Enter valid email address"
                    disabled={lockEmail}
                    className={lockEmail ? "auth-locked-input" : undefined}
                    onChange={(e) => setEmail(e.target.value)}
                />
            </Form.Item>

            {turnstileEnabled && (
                <TurnstileWidget
                    ref={turnstileRef}
                    className="flex justify-center"
                    onTokenChange={setTurnstileToken}
                    onError={() =>
                        setMessage({
                            message: "Security check failed. Please try again.",
                            type: "error",
                        })
                    }
                />
            )}

            <Button
                size="large"
                type="primary"
                htmlType="submit"
                className="w-full"
                loading={isLoading}
                disabled={disabled}
            >
                Continue with OTP
            </Button>
        </Form>
    )
}

export default PasswordlessAuth
