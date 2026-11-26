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
    Input,
} from "@agenta/ui/ui"

/** Create-project prompt. Not the shared `NamePromptModal`: that renders antd, which /m bans. */
export const CreateProjectSheet = ({
    open,
    onOpenChange,
    onSubmit,
    isPending,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string) => void
    isPending?: boolean
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
                    <Input
                        autoFocus
                        value={name}
                        placeholder={t("shell.createProject.namePlaceholder")}
                        onChange={(event) => setName(event.target.value)}
                    />
                    {/* Enter submits; the visible Create sits in the footer, outside this form. */}
                    <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
                </form>
                <DialogFooter>
                    {/* Pending blocks submitting only: a dismissed create still lands and refetches. */}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={!name.trim() || isPending} onClick={submit}>
                        {isPending ? t("shell.createProject.creating") : t("common.create")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
