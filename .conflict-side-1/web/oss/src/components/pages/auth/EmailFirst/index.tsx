import {useState} from "react"

import {Form, Input} from "antd"
import clsx from "clsx"

import ShowErrorMessage from "../assets/ShowErrorMessage"

interface EmailFirstProps {
    email: string
    setEmail: (email: string) => void
    onContinue: (email: string) => Promise<void>
    message: {message: string; sub?: string; type?: "error" | "success" | "info" | "warning"}
    disabled?: boolean
    // Yellow keycap Continue (the primary action) vs a neutral surface button.
    primary?: boolean
    // Returning last-used slot: taller input with an inline "Last used" tag.
    promoted?: boolean
}

const EmailFirst = ({
    email,
    setEmail,
    onContinue,
    message,
    disabled,
    primary = true,
    promoted = false,
}: EmailFirstProps) => {
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
        <Form
            className="w-full flex flex-col gap-[10px]"
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{email}}
        >
            <div className="relative">
                <Form.Item
                    name="email"
                    className="[&_.ant-form-item-required]:before:!hidden w-full mb-0 flex flex-col gap-1"
                    rules={[
                        {required: true, message: "Please add your email!"},
                        {type: "email", message: "Please enter a valid email address!"},
                    ]}
                >
                    <Input
                        type="email"
                        placeholder="Enter your email address"
                        status={message.type === "error" ? "error" : ""}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={disabled}
                        className={clsx("auth-input", promoted && "auth-input-promoted")}
                    />
                </Form.Item>
                {promoted && (
                    <span className="auth-last-used-tag absolute right-3 top-1/2 -translate-y-1/2">
                        Last used
                    </span>
                )}
            </div>

            <button
                type="submit"
                className={clsx(primary ? "auth-btn-yellow" : "auth-surface-btn")}
                disabled={disabled || isLoading}
            >
                Continue
            </button>
            {message.type === "error" && <ShowErrorMessage info={message} className="text-start" />}
        </Form>
    )
}

export default EmailFirst
