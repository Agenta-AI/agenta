import {useEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsAddDomainDialogCatalog from "@agenta/i18n/catalogs/settings.addDomainDialog"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"

import {plainAccessError} from "./accessErrors"
import {Field} from "./Field"

/** Add a domain: the backend returns the token that the DNS instructions show. */
export const AddDomainDialog = ({
    open,
    onClose,
    onSubmit,
}: {
    open: boolean
    onClose: () => void
    onSubmit: (domain: string) => Promise<void>
}) => {
    const t = useT(commonCatalog, settingsAddDomainDialogCatalog)
    const [domain, setDomain] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setDomain("")
        setPending(false)
        setError(null)
    }, [open])

    const submit = async () => {
        const value = domain.trim()
        if (!value) {
            setError(t("settings.addDomainDialog.enterDomain"))
            return
        }
        setPending(true)
        setError(null)
        try {
            await onSubmit(value)
            onClose()
        } catch (cause) {
            setError(plainAccessError(cause, t("settings.addDomainDialog.addError")))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("settings.addDomainDialog.title")}</DialogTitle>
                    <DialogDescription>
                        {t("settings.addDomainDialog.description")}
                    </DialogDescription>
                </DialogHeader>
                <Field
                    label={t("settings.addDomainDialog.domainLabel")}
                    hint={t("settings.addDomainDialog.domainHint")}
                >
                    <Input
                        autoFocus
                        value={domain}
                        placeholder="company.com"
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => setDomain(event.target.value)}
                    />
                </Field>
                {error ? (
                    <p role="alert" className="text-destructive m-0 text-xs">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={pending || !domain.trim()} onClick={() => void submit()}>
                        {pending
                            ? t("settings.addDomainDialog.adding")
                            : t("settings.addDomainDialog.title")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
