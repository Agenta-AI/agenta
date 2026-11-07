import {useEffect, useRef, useState} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n/settings"
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
    /**
     * Resolves to the one-time link, or to null when the server emailed it instead.
     * Rejections show only the server's safe message.
     */
    onRequest: (member: WorkspaceMember) => Promise<string | null>
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
    const t = useT()
    const [link, setLink] = useState<string | null>(null)
    const [emailed, setEmailed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    // Each open or close starts a new run, so a late answer for an earlier target is dropped.
    const sequence = useRef(0)

    // A new target, or none, always starts from the confirmation step with nothing held over.
    useEffect(() => {
        sequence.current += 1
        setLink(null)
        setEmailed(false)
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
                if (sequence.current !== run) return
                if (value === null) setEmailed(true)
                else setLink(value)
            })
            .catch((cause: unknown) => {
                if (sequence.current === run) setError(extractApiErrorMessage(cause))
            })
            .finally(() => {
                if (sequence.current === run) setLoading(false)
            })
    }

    const name =
        target?.user.username ||
        target?.user.email ||
        t("settings.resetPasswordLinkDialog.theMember")

    return (
        <Dialog open={Boolean(target)} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("settings.resetPasswordLinkDialog.title")}</DialogTitle>
                    <DialogDescription>
                        {emailed
                            ? t("settings.resetPasswordLinkDialog.emailed", {name})
                            : link
                              ? t("settings.resetPasswordLinkDialog.share", {name})
                              : t("settings.resetPasswordLinkDialog.generateDescription", {name})}
                    </DialogDescription>
                </DialogHeader>
                {loading ? (
                    <p className="m-0 text-sm text-muted-foreground" aria-live="polite">
                        {t("settings.resetPasswordLinkDialog.generating")}
                    </p>
                ) : null}
                {link ? (
                    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted px-3 py-2">
                        <span className="font-medium">
                            {t("settings.resetPasswordLinkDialog.resetLink")}
                        </span>
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
                    <Button variant="outline" onClick={onClose}>
                        {link || emailed ? t("common.close") : t("common.cancel")}
                    </Button>
                    {!link && !emailed ? (
                        <Button onClick={generate} disabled={loading}>
                            {t("settings.resetPasswordLinkDialog.generateLink")}
                        </Button>
                    ) : null}
                    {link ? (
                        <Button
                            onClick={async () => {
                                setCopied(await copyToClipboard(link))
                            }}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? t("common.copied") : t("common.copy")}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
