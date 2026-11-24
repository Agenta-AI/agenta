import {useEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import createProjectCatalog from "@agenta/i18n/catalogs/shell.createProject"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Input,
} from "@agenta/ui/ui"

/** Create-project prompt. Not the shared `NamePromptModal`: that renders antd, which /m bans. */
export const CreateProjectSheet = ({
    open,
    onOpenChange,
    onSubmit,
    isPending,
    error,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string) => void
    isPending?: boolean
    /** Why the last create failed, shown under the field (KIT-05). */
    error?: string | null
}) => {
    const t = useT(createProjectCatalog, commonCatalog)
    const [name, setName] = useState("")

    useEffect(() => {
        if (!open) setName("")
    }, [open])

    const submit = () => {
        const trimmed = name.trim()
        if (trimmed && !isPending) onSubmit(trimmed)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("shell.createProject.title")}</DialogTitle>
                    <DialogDescription>{t("shell.createProject.description")}</DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault()
                        submit()
                    }}
                >
                    <Field label={t("shell.createProject.namePlaceholder")} error={error}>
                        <Input
                            autoFocus
                            value={name}
                            aria-invalid={error ? true : undefined}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    {/* Enter submits; the visible Create sits in the footer, outside this form. */}
                    <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
                </form>
                <DialogFooter>
                    {/* Pending blocks submitting only: a dismissed create still lands and refetches. */}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={!name.trim() || isPending} onClick={submit}>
                        {isPending
                            ? t("shell.createProject.creating")
                            : t("shell.createProject.title")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
