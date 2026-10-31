import {useEffect, useRef, useState} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {extractApiErrorMessage} from "@agenta/shared/utils"
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

export interface ResetPasswordLinkDialogProps {
    /** The member whose link is being minted; null closes the dialog. */
    target: WorkspaceMember | null
    /** Resolves to the one-time link. Rejections show only the server's safe message. */
    onRequest: (member: WorkspaceMember) => Promise<string>
    onClose: () => void
}

/**
 * Shows the one-time password reset link for another member.
 *
 * The link is requested only after the reader confirms, exists only once the request resolves
 * and is cleared on close. It is never logged or
 * put into an error: a failed request shows the server's message, not the response body.
 */
export const ResetPasswordLinkDialog = ({
    target,
    onRequest,
    onClose,
}: ResetPasswordLinkDialogProps) => {
    const [link, setLink] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    // Each open or close starts a new run, so a late answer for an earlier target is dropped.
    const sequence = useRef(0)

    // A new target, or none, always starts from the confirmation step with nothing held over.
    useEffect(() => {
        sequence.current += 1
        setLink(null)
        setError(null)
        setCopied(false)
        setLoading(false)
    }, [target])

    // Minting a login link is a deliberate step, so it waits for a confirmation, as in the old app.
    const generate = () => {
        if (!target) return
        const run = ++sequence.current
        setError(null)
        setLoading(true)
        void onRequest(target)
            .then((value) => {
                if (sequence.current === run) setLink(value)
            })
            .catch((cause: unknown) => {
                if (sequence.current === run) setError(extractApiErrorMessage(cause))
            })
            .finally(() => {
                if (sequence.current === run) setLoading(false)
            })
    }

    const close = () => {
        sequence.current += 1
        setLink(null)
        setError(null)
        setLoading(false)
        setCopied(false)
        onClose()
    }

    return (
        <Dialog open={Boolean(target)} onOpenChange={(next) => (next ? undefined : close())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reset password link</DialogTitle>
                    <DialogDescription>
                        {link
                            ? "Share this one-time link with "
                            : "Generate a one-time link that lets "}
                        {target?.user.username || target?.user.email || "the member"}
                        {link
                            ? ". It cannot be retrieved again after you close this."
                            : " set a new password."}
                    </DialogDescription>
                </DialogHeader>
                {loading ? (
                    <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
                        Generating a one-time link…
                    </p>
                ) : null}
                {link ? (
                    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted px-3 py-2">
                        <span className="font-medium">Reset link</span>
                        {/* Selectable: the clipboard can be refused outside a secure context. */}
                        <span className="break-all select-all">{link}</span>
                    </div>
                ) : null}
                {error ? (
                    <p role="alert" className="m-0 text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={close}>
                        {link ? "Close" : "Cancel"}
                    </Button>
                    {!link ? (
                        <Button onClick={generate} disabled={loading}>
                            Generate link
                        </Button>
                    ) : null}
                    {link ? (
                        <Button
                            onClick={async () => {
                                setCopied(await copyToClipboard(link))
                            }}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? "Copied" : "Copy"}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
