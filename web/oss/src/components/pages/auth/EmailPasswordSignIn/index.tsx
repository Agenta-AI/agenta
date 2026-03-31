import {useRef, useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {signIn, signUp} from "supertokens-auth-react/recipe/emailpassword"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"
import {
    clearPendingTurnstileToken,
    isTurnstileEnabled,
    setPendingTurnstileToken,
} from "@/oss/lib/helpers/auth/turnstile"

import ShowErrorMessage from "../assets/ShowErrorMessage"
import {EmailPasswordAuthProps} from "../assets/types"
import TurnstileWidget, {TurnstileWidgetHandle} from "../Turnstile"

const EmailPasswordSignIn = ({
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

    const signUpWithPassword = async (email: string, password: string, token: string | null) => {
        if (turnstileEnabled) {
            setPendingTurnstileToken(token)
        }

        return signUp({
            formFields: [
                {id: "email", value: email},
                {id: "password", value: password},
            ],
        })
    }

    const signInClicked: FormProps<{email: string; password: string}>["onFinish"] = async (
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
            console.log("[emailpassword-signin] submit", {
                email: values.email,
            })
            const response = await signIn({
                formFields: [
                    {id: "email", value: values.email},
                    {id: "password", value: values.password},
                ],
            })

            if (response.status === "FIELD_ERROR") {
                response.formFields.forEach((res) => {
                    setMessage({message: res.error, type: "error"})
                })
            } else if (response.status === "WRONG_CREDENTIALS_ERROR") {
                clearPendingTurnstileToken()

                let retryToken = turnstileToken
                if (turnstileEnabled) {
                    setMessage({
                        message: "Please complete the security check again to continue.",
                        type: "error",
                    })
                    retryToken = turnstileRef.current
                        ? await turnstileRef.current.refreshToken()
                        : null
                    setTurnstileToken(retryToken)

                    if (!retryToken) {
                        return
                    }
                }

                try {
                    const signUpResponse = await signUpWithPassword(
                        values.email,
                        values.password,
                        retryToken,
                    )

                    if (signUpResponse.status === "FIELD_ERROR") {
                        const emailExists = signUpResponse.formFields.some((res) =>
                            res.error.toLowerCase().includes("already exists"),
                        )
                        setMessage({
                            message: emailExists
                                ? "Invalid email or password"
                                : signUpResponse.formFields[0]?.error || "Unable to sign up",
                            type: "error",
                        })
                        return
                    }

                    if (signUpResponse.status === "SIGN_UP_NOT_ALLOWED") {
                        setMessage({
                            message:
                                "You need to be invited by the organization owner to gain access.",
                            type: "error",
                        })
                        return
                    }

                    setMessage({message: "Verification successful", type: "success"})
                    const {user} = signUpResponse as {
                        user?: {loginMethods?: unknown[]}
                    }
                    console.log("[emailpassword-signin] signup fallback ok", {
                        hasUser: Boolean(user),
                        loginMethods: user?.loginMethods,
                    })
                    await handleAuthSuccess({user})
                } catch (signUpError) {
                    authErrorMsg(signUpError)
                }
            } else if (response.status === "SIGN_IN_NOT_ALLOWED") {
                setMessage({
                    message: "You need to be invited by the organization owner to gain access.",
                    type: "error",
                })
            } else {
                setMessage({message: "Verification successful", type: "success"})
                const {user} = response as {
                    user?: {loginMethods?: unknown[]}
                }
                console.log("[emailpassword-signin] signin ok", {
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
                onFinish={signInClicked}
                initialValues={{email: initialEmail}}
            >
                <Form.Item
                    name="email"
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
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your password!"}]}
                >
                    <Input
                        size="large"
                        type="password"
                        value={form.password}
                        placeholder="Enter your password"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setForm({...form, password: e.target.value})}
                    />
                </Form.Item>

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
            </Form>
        </div>
    )
}

export default EmailPasswordSignIn
