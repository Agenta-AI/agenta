import {useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {signIn, signUp} from "supertokens-auth-react/recipe/emailpassword"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"

import ShowErrorMessage from "../assets/ShowErrorMessage"
import {EmailPasswordAuthProps} from "../assets/types"

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

    const signInClicked: FormProps<{email: string; password: string}>["onFinish"] = async (
        values,
    ) => {
        try {
            setIsLoading(true)
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
                try {
                    const signUpResponse = await signUp({
                        formFields: [
                            {id: "email", value: values.email},
                            {id: "password", value: values.password},
                        ],
                    })
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
                    const {createdNewRecipeUser, user} = signUpResponse as {
                        createdNewRecipeUser?: boolean
                        user?: {loginMethods?: unknown[]}
                    }
                    await handleAuthSuccess({createdNewRecipeUser, user})
                } catch (signUpError) {
                    authErrorMsg(signUpError)
                }
            } else {
                setMessage({message: "Verification successful", type: "success"})
                const {createdNewRecipeUser, user} = response as {
                    createdNewRecipeUser?: boolean
                    user?: {loginMethods?: unknown[]}
                }
                await handleAuthSuccess({createdNewRecipeUser, user})
            }
        } catch (error) {
            authErrorMsg(error)
        } finally {
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
            </Form>
        </div>
    )
}

export default EmailPasswordSignIn
