import {useEffect, useState} from "react"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

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
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>Create project</SheetTitle>
                    <SheetDescription>Projects keep agents and sessions apart.</SheetDescription>
                </SheetHeader>
                <form
                    className="flex flex-col gap-3 px-4"
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
                <SheetFooter>
                    {/* Pending blocks submitting only: a dismissed create still lands and refetches. */}
                    <Button disabled={!name.trim() || isPending} onClick={submit}>
                        {isPending ? "Creating…" : "Create"}
                    </Button>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
