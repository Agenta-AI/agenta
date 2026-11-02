import {useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Check, Copy} from "@phosphor-icons/react"

export interface InvitedLink {
    email: string
    url: string
}

/** With no email service the API returns the invite link, so the inviter shares it by hand. */
export const InvitedLinkDialog = ({
    invited,
    onClose,
}: {
    invited: InvitedLink | null
    onClose: () => void
}) => {
    const [copied, setCopied] = useState(false)
    const close = () => {
        setCopied(false)
        onClose()
    }

    return (
        <Dialog open={Boolean(invited)} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invited user link</DialogTitle>
                    <DialogDescription>
                        Share the link with the user that you have invited.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-w-0 flex-col gap-3 text-sm">
                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Member name</span>
                        <span className="break-all">{invited?.email}</span>
                    </div>
                    <div className="bg-muted flex flex-col gap-1 rounded-md px-3 py-2">
                        <span className="font-medium">Invited link</span>
                        {/* Selectable: the clipboard is refused on a plain HTTP deployment. */}
                        <span className="break-all select-all">{invited?.url}</span>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={async () => {
                            if (invited) setCopied(await copyToClipboard(invited.url))
                        }}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "Copied" : "Copy"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
