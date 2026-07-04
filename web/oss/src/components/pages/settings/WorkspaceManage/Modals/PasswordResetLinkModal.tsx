import {useState} from "react"

import {Alert, AlertDescription, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Check, Copy, Warning} from "@phosphor-icons/react"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {PasswordResetLinkModalProps} from "./assets/types"

const PasswordResetLinkModal = ({
    username,
    generatedLink,
    open,
    onClose,
}: PasswordResetLinkModalProps) => {
    const [isCopied, setIsCopied] = useState(false)

    const onCopyLink = () => {
        setIsCopied(true)
        navigator.clipboard.writeText(generatedLink)
        setTimeout(() => setIsCopied(false), 2000)
    }

    const onCopyLinkAndClose = () => {
        onCopyLink()
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
                    <DialogTitle>Password reset link</DialogTitle>
                </DialogHeader>
                <section className="flex flex-col gap-4">
                    <span>
                        Share the link with your team member so that they may reset their password.
                    </span>

                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Member name</span>
                        <AvatarWithLabel name={username} />
                    </div>

                    <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2">
                        <div className="flex items-center justify-between">
                            <span className="font-medium">Password reset link</span>
                            <Button variant="ghost" size="sm" onClick={onCopyLink}>
                                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                {isCopied ? "Copied" : "Copy"}
                            </Button>
                        </div>
                        <span className="break-all">{generatedLink}</span>
                    </div>

                    <Alert>
                        <Warning />
                        <AlertTitle>Warning:</AlertTitle>
                        <AlertDescription>
                            You will not be able to generate link again once this modal is closed.
                        </AlertDescription>
                    </Alert>
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

export default PasswordResetLinkModal
