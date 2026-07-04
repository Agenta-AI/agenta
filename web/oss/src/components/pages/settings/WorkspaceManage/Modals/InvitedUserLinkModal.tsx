import {useMemo, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Check, Copy} from "@phosphor-icons/react"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {InvitedUserLinkModalProps} from "./assets/types"

const InvitedUserLinkModal = ({invitedUserData, open, onClose}: InvitedUserLinkModalProps) => {
    const [isCopied, setIsCopied] = useState(false)

    const formattedUri = useMemo(() => {
        try {
            const uri = new URL(invitedUserData?.uri.replaceAll('"', ""))
            return uri.href
        } catch {
            return invitedUserData?.uri
        }
    }, [invitedUserData])

    const onCopyLink = async () => {
        setIsCopied(true)
        await navigator.clipboard.writeText(formattedUri)
        setTimeout(() => setIsCopied(false), 2000)
    }

    const onCopyLinkAndClose = async () => {
        await onCopyLink()
        onClose()
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invited user link</DialogTitle>
                </DialogHeader>
                <section className="flex flex-col gap-4">
                    <span>Share the link with the user that you have invited.</span>

                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Member name</span>
                        <AvatarWithLabel name={invitedUserData?.email} />
                    </div>

                    <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2">
                        <div className="flex items-center justify-between">
                            <span className="font-medium">Invited link</span>
                            <Button variant="ghost" size="sm" onClick={onCopyLink}>
                                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                {isCopied ? "Copied" : "Copy"}
                            </Button>
                        </div>
                        <span className="break-all">{formattedUri}</span>
                    </div>
                </section>
                <DialogFooter>
                    <Button variant="outline" onClick={onCopyLinkAndClose}>
                        <Copy size={14} />
                        Copy & Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default InvitedUserLinkModal
