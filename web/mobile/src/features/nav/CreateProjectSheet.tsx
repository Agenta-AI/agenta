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

/**
 * Create-project prompt, as the app's own sheet rather than the shared `NamePromptModal` —
 * that one renders an antd modal, which /m does not ship and which laid out badly here with a
 * keyboard open. `responsive` puts it on the bottom edge on a phone and the right edge from lg.
 */
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
        <Sheet open={open} onOpenChange={(next) => (isPending ? undefined : onOpenChange(next))}>
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
                    {/* Submit-on-enter without a visible button inside the form: the footer's
                        Create sits outside it, where the sheet's layout puts it. */}
                    <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
                </form>
                <SheetFooter>
                    <Button disabled={!name.trim() || isPending} onClick={submit}>
                        {isPending ? "Creating…" : "Create"}
                    </Button>
                    <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
