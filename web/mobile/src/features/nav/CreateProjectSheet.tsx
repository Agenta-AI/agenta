import {useEffect, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {Input} from "@/components/ui/input"

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
                    <DialogTitle>Create project</DialogTitle>
                    <DialogDescription>Projects keep agents and sessions apart.</DialogDescription>
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
                        placeholder="Project name"
                        onChange={(event) => setName(event.target.value)}
                    />
                    {/* Enter submits; the visible Create sits in the footer, outside this form. */}
                    <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
                </form>
                <DialogFooter>
                    {/* Pending blocks submitting only: a dismissed create still lands and refetches. */}
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button disabled={!name.trim() || isPending} onClick={submit}>
                        {isPending ? "Creating…" : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
