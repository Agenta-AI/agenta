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
    /** Verb + object, e.g. "Create project" (ACT-02). */
    okText: string
}

/** One-field create modal (project, organization): a Dialog with one Field. */
export const NamePromptModal = ({
    title,
    label,
    placeholder,
    open,
    onCancel,
    onSubmit,
    isPending,
    okText,
}: NamePromptModalProps) => {
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
                    className="flex flex-col py-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        submit()
                    }}
                >
                    <Field
                        label={label}
                        error={
                            touched && !name.trim() ? `Enter a ${label.toLowerCase()}` : undefined
                        }
                    >
                        <Input
                            autoFocus
                            value={name}
                            placeholder={placeholder}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
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
