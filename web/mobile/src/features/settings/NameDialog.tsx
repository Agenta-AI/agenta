import {useEffect, useId, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
} from "@agenta/ui/ui"

/** One name field in a dialog, for creating a project or an organization. */
export const NameDialog = ({
    open,
    title,
    description,
    submitLabel,
    pending,
    initialValue = "",
    placeholder,
    label,
    error,
    notice,
    submitDisabled,
    onClose,
    onSubmit,
}: {
    open: boolean
    title: string
    description?: string
    submitLabel: string
    pending: boolean
    initialValue?: string
    placeholder?: string
    /** A visible label above the field. Without it the field has none, as before. */
    label?: string
    error?: string | null
    /** Shown under the field, for a refusal the reader can act on. */
    notice?: ReactNode
    /** A limit the reader cannot pass here: the submit button stays off. */
    submitDisabled?: boolean
    onClose: () => void
    onSubmit: (name: string) => void
}) => {
    const t = useT(commonCatalog)
    const [value, setValue] = useState(initialValue)
    const inputId = useId()

    useEffect(() => {
        if (open) setValue(initialValue)
    }, [open, initialValue])

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description ? <DialogDescription>{description}</DialogDescription> : null}
                </DialogHeader>
                <div className="flex flex-col gap-1.5">
                    {label ? <Label htmlFor={inputId}>{label}</Label> : null}
                    <Input
                        id={label ? inputId : undefined}
                        autoFocus
                        value={value}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={placeholder ?? t("common.name")}
                    />
                    {error ? (
                        <p role="alert" className="text-destructive m-0 text-xs">
                            {error}
                        </p>
                    ) : null}
                    {notice}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        disabled={pending || !value.trim() || submitDisabled}
                        onClick={() => onSubmit(value.trim())}
                    >
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
