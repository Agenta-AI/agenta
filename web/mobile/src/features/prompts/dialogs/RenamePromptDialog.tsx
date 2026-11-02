import {useEffect, useState} from "react"

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

import {promptsCopy} from "../promptsCopy"

/** Edits a prompt's name and description. */
export const RenamePromptDialog = ({
    open,
    initialName,
    initialDescription,
    pending = false,
    error,
    onSubmit,
    onClose,
}: {
    open: boolean
    initialName: string
    initialDescription: string
    pending?: boolean
    error?: string | null
    onSubmit: (fields: {name: string; description: string}) => void
    onClose: () => void
}) => {
    const copy = promptsCopy.renamePromptDialog
    const [name, setName] = useState(initialName)
    const [description, setDescription] = useState(initialDescription)
    useEffect(() => {
        if (!open) return
        setName(initialName)
        setDescription(initialDescription)
    }, [open, initialName, initialDescription])

    const trimmed = name.trim()
    const canSubmit = trimmed.length > 0 && !pending

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (canSubmit) onSubmit({name: trimmed, description: description.trim()})
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>{copy.title}</DialogTitle>
                    </DialogHeader>
                    <Field label={copy.nameLabel} error={trimmed ? undefined : copy.emptyName}>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    <Field label={copy.descriptionLabel}>
                        <Input
                            value={description}
                            placeholder={copy.descriptionPlaceholder}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                    </Field>
                    {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={onClose}
                        >
                            {promptsCopy.folderDialog.cancel}
                        </Button>
                        <Button type="submit" disabled={!canSubmit}>
                            {pending ? "Working…" : copy.save}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
