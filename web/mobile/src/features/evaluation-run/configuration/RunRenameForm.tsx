import {useState, type FormEvent} from "react"

import {Button, Input, LoadingButton, Textarea} from "@agenta/ui/ui"

/** The name and description of a run, with Cancel and Save. Save needs a name. */
export const RunRenameForm = ({
    initialName,
    initialDescription,
    saving,
    onSave,
    onCancel,
}: {
    initialName: string
    initialDescription: string
    saving: boolean
    onSave: (name: string, description: string) => Promise<boolean>
    onCancel: () => void
}) => {
    const [name, setName] = useState(initialName)
    const [description, setDescription] = useState(initialDescription)
    const canSave = name.trim().length > 0 && !saving

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (canSave) void onSave(name, description)
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                Name
                <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Run name"
                    disabled={saving}
                />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                Description
                <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Description (optional)"
                    rows={3}
                    disabled={saving}
                />
            </label>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <LoadingButton type="submit" size="sm" loading={saving} disabled={!canSave}>
                    Save
                </LoadingButton>
            </div>
        </form>
    )
}
