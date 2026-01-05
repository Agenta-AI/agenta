import {Button, Form, FormProps, Input} from "antd"
import {createCode} from "supertokens-auth-react/recipe/passwordless"

import ShowErrorMessage from "@/oss/components/pages/auth/assets/ShowErrorMessage"

import {PasswordlessAuthProps} from "../assets/types"

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
    const sendOTP: FormProps<{email: string}>["onFinish"] = async (values) => {
        try {
            setIsLoading(true)
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
