import {useState} from "react"

import {Check, Copy} from "@phosphor-icons/react"
import {Alert, Button, Modal, Typography} from "antd"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {PasswordResetLinkModalProps} from "./assets/types"

const PasswordResetLinkModal = ({
    username,
    generatedLink,
    ...props
}: PasswordResetLinkModalProps) => {
    const [isCopied, setIsCopied] = useState(false)

    const onCopyLink = () => {
        setIsCopied(true)

        navigator.clipboard.writeText(generatedLink)
        setTimeout(() => {
            setIsCopied(false)
        }, 2000)
    }

    const onCopyLinkAndClose = () => {
        onCopyLink()
        props.onCancel?.({} as any)
    }

    return (
        <Modal
            title="Password reset link"
            okText="Copy & Close"
            okButtonProps={{type: "default"}}
            cancelButtonProps={{className: "hidden"}}
            onOk={onCopyLinkAndClose}
            destroyOnHidden
            centered
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Typography.Text>
                    Share the link with your team member so that they may reset their password.
                </Typography.Text>

                <div className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">Member name</Typography.Text>
                    <AvatarWithLabel name={username} />
                </div>

                <div className="py-1 px-3 rounded-md gap-2 bg-[#0517290A]">
                    <div className="flex items-center justify-between">
                        <Typography.Text className="font-medium">
                            Password reset link
                        </Typography.Text>
                        <Button
                            type="link"
                            icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                            className="px-0"
                            onClick={onCopyLink}
                        >
                            {isCopied ? "Copied" : "Copy"}
                        </Button>
                    </div>
                    <Typography.Text>{generatedLink}</Typography.Text>
                </div>

                <Alert
                    showIcon
                    type="warning"
                    message={
                        <div className="flex flex-col">
                            <Typography.Text className="font-medium">Warning:</Typography.Text>
                            <Typography.Text>
                                You will not be able to generate link again once this modal is
                                closed.
                            </Typography.Text>
                        </div>
                    }
                />
            </section>
        </Modal>
    )
}

export default PasswordResetLinkModal
