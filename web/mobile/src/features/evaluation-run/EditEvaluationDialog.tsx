import {useEffect, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    LoadingButton,
    Textarea,
} from "@agenta/ui/ui"

/**
 * The old app's "Edit evaluation" form, name and description only. Update is off until a field
 * changes, and while the name is blank. A failed save keeps the dialog open with the draft.
 */
export const EditEvaluationDialog = ({
    open,
    name,
    description,
    onClose,
    onSave,
}: {
    open: boolean
    name: string
    description: string
    onClose: () => void
    onSave: (values: {name: string; description: string}) => Promise<void>
}) => {
    const [draftName, setDraftName] = useState(name)
    const [draftDescription, setDraftDescription] = useState(description)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        setDraftName(name)
        setDraftDescription(description)
    }, [open, name, description])

    const dirty = draftName !== name || draftDescription !== description
    const canSave = dirty && draftName.trim().length > 0 && !saving

    const save = async () => {
        if (!canSave) return
        setSaving(true)
        try {
            await onSave({name: draftName.trim(), description: draftDescription})
            message.success("Evaluation updated")
            onClose()
        } catch (error) {
            console.error("[EditEvaluationDialog] update failed", error)
            message.error("Failed to update evaluation. Please try again.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => (next || saving ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit evaluation</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="edit-evaluation-name">Name</Label>
                        <Input
                            id="edit-evaluation-name"
                            autoFocus
                            placeholder="Evaluation name"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="edit-evaluation-description">Description</Label>
                        <Textarea
                            id="edit-evaluation-description"
                            placeholder="Add a description"
                            rows={3}
                            value={draftDescription}
                            onChange={(event) => setDraftDescription(event.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <LoadingButton loading={saving} disabled={!canSave} onClick={save}>
                        Update
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
