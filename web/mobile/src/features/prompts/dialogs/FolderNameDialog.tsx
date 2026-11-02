import {useEffect, useState} from "react"

import {folderSlug} from "@agenta/entities/workflow"
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

import {promptsCopy} from "../promptsCopy"

/** Names a new folder or renames one. The caller says what the path would be for a name. */
export const FolderNameDialog = ({
    open,
    mode,
    initialName = "",
    pathFor,
    pending = false,
    error,
    onSubmit,
    onClose,
}: {
    open: boolean
    mode: "create" | "rename"
    initialName?: string
    pathFor: (name: string) => string
    pending?: boolean
    /** The sentence for a failed save; the dialog stays open with the name as typed. */
    error?: string | null
    onSubmit: (name: string) => void
    onClose: () => void
}) => {
    const copy = promptsCopy.folderDialog
    const [name, setName] = useState(initialName)
    useEffect(() => {
        if (open) setName(initialName)
    }, [open, initialName])

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
                        if (canSubmit) onSubmit(trimmed)
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {mode === "create" ? copy.createTitle : copy.renameTitle}
                        </DialogTitle>
                        <DialogDescription>{copy.description}</DialogDescription>
                    </DialogHeader>
                    <Field>
                        <Input
                            autoFocus
                            aria-label={promptsCopy.columns.name}
                            value={name}
                            placeholder={copy.placeholder}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        <span>{copy.slug(folderSlug(trimmed))}</span>
                        <span className="break-all">{copy.path(pathFor(trimmed))}</span>
                    </div>
                    {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={onClose}
                        >
                            {promptsCopy.cancel}
                        </Button>
                        <Button type="submit" disabled={!canSubmit}>
                            {pending
                                ? promptsCopy.working
                                : mode === "create"
                                  ? copy.create
                                  : copy.save}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
