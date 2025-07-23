import {useMemo, useState} from "react"

import {Check, Copy} from "@phosphor-icons/react"
import {Button, Modal, Typography} from "antd"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {InvitedUserLinkModalProps} from "./assets/types"

const InvitedUserLinkModal = ({invitedUserData, ...props}: InvitedUserLinkModalProps) => {
    const [isCopied, setIsCopied] = useState(false)

    const formattedURi = useMemo(() => {
        try {
            const uri = new URL(invitedUserData?.uri.replaceAll('"', ""))
            return uri.href
        } catch (error) {
            return invitedUserData?.uri
        }
    }, [invitedUserData])

    const onCopyLink = async () => {
        setIsCopied(true)

        await navigator.clipboard.writeText(formattedURi)

        setTimeout(() => {
            setIsCopied(false)
        }, 2000)
    }

    const onCopyLinkAndClose = async () => {
        await onCopyLink()
        props.onCancel?.({} as any)
    }

    return (
        <Modal
            title="Invited user link"
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
                    Share the link with the user that you have invited.
                </Typography.Text>

                <div className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">Member name</Typography.Text>

                    <AvatarWithLabel name={invitedUserData?.email} />
                </div>

                <div className="py-1 px-3 rounded-md gap-2 bg-[#0517290A]">
                    <div className="flex items-center justify-between">
                        <Typography.Text className="font-medium">Invited link</Typography.Text>
                        <Button
                            type="link"
                            icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                            className="px-0"
                            onClick={onCopyLinkAndClose}
                        >
                            {isCopied ? "Copied" : "Copy"}
                        </Button>
                    </div>

                    <Typography.Text>{formattedURi}</Typography.Text>
                </div>
            </section>
        </Modal>
    )
}

export default InvitedUserLinkModal
