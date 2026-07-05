import {useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Form, Input} from "antd"

import ShowErrorMessage from "../assets/ShowErrorMessage"

interface EmailFirstProps {
    email: string
    setEmail: (email: string) => void
    onContinue: (email: string) => Promise<void>
    message: {message: string; sub?: string; type?: "error" | "success" | "info" | "warning"}
    disabled?: boolean
}

const EmailFirst = ({email, setEmail, onContinue, message, disabled}: EmailFirstProps) => {
    const [isLoading, setIsLoading] = useState(false)

    const handleSubmit = async (values: {email: string}) => {
        try {
            setIsLoading(true)
            await onContinue(values.email)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div>
            <Form
                className="w-full flex flex-col gap-4"
                layout="vertical"
                onFinish={handleSubmit}
                initialValues={{email}}
            >
                <Form.Item
                    name="email"
                    className="[&_.ant-form-item-required]:before:!hidden [&_.ant-form-item-required]:font-medium w-full mb-0 flex flex-col gap-1"
                    rules={[
                        {required: true, message: "Please add your email!"},
                        {type: "email", message: "Please enter a valid email address!"},
                    ]}
                >
                    <Input
                        size="large"
                        type="email"
                        value={email}
                        placeholder="Enter your email address"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={disabled}
                    />
                </Form.Item>

                <Button className="w-full" disabled={disabled || isLoading} size="lg" type="submit">
                    {isLoading ? <Spinner /> : null}
                    Continue
                </Button>
                {message.type === "error" && (
                    <ShowErrorMessage info={message} className="text-start" />
                )}
            </Form>
        </div>
    )
}

export default EmailFirst
