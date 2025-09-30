import {useState} from "react"

import {Button, Form, FormProps, Input} from "antd"
import {signUp} from "supertokens-auth-react/recipe/emailpassword"

import usePostAuthRedirect from "@/oss/hooks/usePostAuthRedirect"

import ShowErrorMessage from "../assets/ShowErrorMessage"
import {EmailPasswordAuthProps} from "../assets/types"

const EmailPasswordAuth = ({
    message,
    setMessage,
    authErrorMsg,
    initialEmail,
}: EmailPasswordAuthProps) => {
    const {handleAuthSuccess} = usePostAuthRedirect()
    const [form, setForm] = useState({email: initialEmail || "", password: ""})
    const [isLoading, setIsLoading] = useState(false)

    const signUpClicked: FormProps<{email: string; password: string}>["onFinish"] = async (
        values,
    ) => {
        try {
            setIsLoading(true)
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
                onFinish={signUpClicked}
                initialValues={{email: initialEmail}}
            >
                <Form.Item
                    name="email"
                    label="Email"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[{required: true, message: "Please add your email!"}]}
                >
                    <Input
                        size="large"
                        type="email"
                        value={form.email}
                        placeholder="Enter valid email address"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setForm({...form, email: e.target.value})}
                    />
                </Form.Item>
                <Form.Item
                    name="password"
                    label="Password"
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

                <Button
                    size="large"
                    type="primary"
                    htmlType="submit"
                    className="w-full"
                    loading={isLoading}
                >
                    Sign in
                </Button>
                {message.type == "error" && (
                    <ShowErrorMessage info={message} className="text-start" />
                )}
            </Form>
        </div>
    )
}

export default EmailPasswordAuth
