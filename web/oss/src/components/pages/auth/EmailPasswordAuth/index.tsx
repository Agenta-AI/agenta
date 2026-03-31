import {useRef, useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {signUp} from "supertokens-auth-react/recipe/emailpassword"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {
    clearPendingTurnstileToken,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@/oss/lib/helpers/auth/turnstile"

import ShowErrorMessage from "../assets/ShowErrorMessage"
import {EmailPasswordAuthProps} from "../assets/types"
import TurnstileWidget, {TurnstileWidgetHandle} from "../Turnstile"

const EmailPasswordAuth = ({
    message,
    setMessage,
    authErrorMsg,
    initialEmail,
    lockEmail = false,
}: EmailPasswordAuthProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
    const [form, setForm] = useState({email: initialEmail || "", password: ""})
    const [isLoading, setIsLoading] = useState(false)
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

    const signUpClicked: FormProps<{email: string; password: string}>["onFinish"] = async (
        values,
    ) => {
        if (!ensureTurnstileToken()) {
            return
        }

        try {
            setIsLoading(true)
            if (turnstileEnabled) {
                setPendingTurnstileToken(turnstileToken)
            }
            console.log("[emailpassword-auth] signup submit", {
                email: values.email,
            })
            const response = await signUp({
                formFields: [
                    {
                        id: "email",
                        value: values.email,
                    },
                    {
                        id: "password",
                        value: values.password,
                    },
                ],
            })

            if (response.status === "SIGN_UP_NOT_ALLOWED") {
                setMessage({
                    message: "You need to be invited by the organization owner to gain access.",
                    type: "error",
                })
            } else if (response.status === "FIELD_ERROR") {
                response.formFields.map((res) => {
                    setMessage({message: res.error, type: "error"})
                })
            } else {
                setMessage({message: "Verification successful", type: "success"})
                const {user} = response as {
                    user?: {loginMethods?: unknown[]}
                }
                console.log("[emailpassword-auth] signup ok", {
                    hasUser: Boolean(user),
                    loginMethods: user?.loginMethods,
                })
                await handleAuthSuccess({user})
            }
        } catch (error) {
            authErrorMsg(error)
        } finally {
            resetTurnstile()
            setIsLoading(false)
        }
    }

    return (
        <div>
            <Form
                className="w-full flex flex-col gap-4"
                layout="vertical"
                onFinish={signUpClicked}
                initialValues={{email: initialEmail}}
            >
                <Form.Item
                    name="email"
                    // label="Email"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your email!"}]}
                >
                    <Input
                        size="large"
                        type="email"
                        value={form.email}
                        placeholder="Enter valid email address"
                        status={message.type === "error" ? "error" : ""}
                        disabled={lockEmail}
                        className={lockEmail ? "auth-locked-input" : undefined}
                        onChange={(e) => setForm({...form, email: e.target.value})}
                    />
                </Form.Item>
                <Form.Item
                    name="password"
                    // label="Password"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your password!"}]}
                >
                    <Input
                        size="large"
                        type="password"
                        value={form.password}
                        placeholder="Enter a unique password"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setForm({...form, password: e.target.value})}
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
                >
                    Continue with password
                </Button>
                {message.type == "error" && (
                    <ShowErrorMessage info={message} className="text-start" />
                )}
            </Form>
        </div>
    )
}

export default EmailPasswordAuth
