import {useEffect, useId, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"

export interface NamePromptModalProps {
    title: string
    label: string
    placeholder: string
    open: boolean
    onCancel: () => void
    onSubmit: (name: string) => void
    isPending?: boolean
    okText?: string
}

/** One-field create modal (project, organization): a Dialog + a plain input. */
export const NamePromptModal = ({
    title,
    label,
    placeholder,
    open,
    onCancel,
    onSubmit,
    isPending,
    okText = "Create",
}: NamePromptModalProps) => {
    const inputId = useId()
    const [name, setName] = useState("")
    const [touched, setTouched] = useState(false)
    useEffect(() => {
        if (!open) {
            setName("")
            setTouched(false)
        }
    }, [open])

    const submit = () => {
        setTouched(true)
        if (name.trim()) onSubmit(name.trim())
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <form
                    className="flex flex-col gap-1 py-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        submit()
                    }}
                >
                    <label className="text-xs text-muted-foreground" htmlFor={inputId}>
                        {label}
                    </label>
                    <input
                        autoFocus
                        id={inputId}
                        value={name}
                        placeholder={placeholder}
                        onChange={(event) => setName(event.target.value)}
                        className="box-border h-8 w-full rounded-md border border-solid border-border bg-background px-2 text-label text-foreground outline-none focus:border-primary"
                    />
                    {touched && !name.trim() ? (
                        <span className="text-xs text-destructive">{`Please enter a ${label.toLowerCase()}`}</span>
                    ) : null}
                </form>
                <DialogFooter>
                    <Button variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <LoadingButton loading={isPending} onClick={submit}>
                        {okText}
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
