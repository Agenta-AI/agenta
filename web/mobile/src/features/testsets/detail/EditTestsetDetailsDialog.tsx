import {useEffect, useId, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Textarea,
} from "@agenta/ui/ui"

/**
 * Name and description of the test set. Save is off while the name is blank: the old app saved
 * an empty name. A save does not create a revision.
 */
export const EditTestsetDetailsDialog = ({
    open,
    name,
    description,
    pending,
    onClose,
    onSave,
}: {
    open: boolean
    name: string
    description: string
    pending: boolean
    onClose: () => void
    onSave: (name: string, description: string) => void
}) => {
    const [draftName, setDraftName] = useState(name)
    const [draftDescription, setDraftDescription] = useState(description)

    useEffect(() => {
        if (!open) return
        setDraftName(name)
        setDraftDescription(description)
    }, [open, name, description])

    const canSave = draftName.trim().length > 0 && !pending
    const nameId = useId()
    const descriptionId = useId()

    return (
        <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit test set details</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={nameId}>Name</Label>
                        <Input
                            id={nameId}
                            autoFocus
                            placeholder="Test set name"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={descriptionId}>Description</Label>
                        <Textarea
                            id={descriptionId}
                            placeholder="Test set description (optional)"
                            rows={3}
                            value={draftDescription}
                            onChange={(event) => setDraftDescription(event.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!canSave}
                        onClick={() => onSave(draftName.trim(), draftDescription.trim())}
                    >
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
