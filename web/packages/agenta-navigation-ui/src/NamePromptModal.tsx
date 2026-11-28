import {useEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {LoadingButton} from "@agenta/ui/composed"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Input,
} from "@agenta/ui/ui"

export interface NamePromptModalProps {
    title: string
    label: string
    placeholder: string
    open: boolean
    onCancel: () => void
    onSubmit: (name: string) => void
    isPending?: boolean
    /** Verb + object (ACT-02); the title ("Create project") when not given. */
    okText?: string
}

/** One-field create modal (project, organization): a Dialog with one Field. */
export const NamePromptModal = ({
    title,
    label,
    placeholder,
    open,
    onCancel,
    onSubmit,
    isPending,
    okText,
}: NamePromptModalProps) => {
    const t = useT(commonCatalog)
    const [name, setName] = useState("")
    const [touched, setTouched] = useState(false)
    useEffect(() => {
        if (!open) {
            setName("")
            setTouched(false)
        }
    }, [open])

    const submit = () => {
        setTouched(true)
        if (name.trim()) onSubmit(name.trim())
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form
                    className="flex flex-col py-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        submit()
                    }}
                >
                    <Field
                        label={label}
                        error={touched && !name.trim() ? t("common.required") : undefined}
                    >
                        <Input
                            autoFocus
                            value={name}
                            placeholder={placeholder}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                </form>
                <DialogFooter>
                    <Button variant="ghost" onClick={onCancel}>
                        {t("common.cancel")}
                    </Button>
                    <LoadingButton loading={isPending} onClick={submit}>
                        {okText ?? title}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
