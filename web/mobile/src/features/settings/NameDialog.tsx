import {useEffect, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"

/** One name field in a dialog, for creating a project or an organization. */
export const NameDialog = ({
    open,
    title,
    description,
    submitLabel,
    pending,
    initialValue = "",
    placeholder = "Name",
    onClose,
    onSubmit,
}: {
    open: boolean
    title: string
    description?: string
    submitLabel: string
    pending: boolean
    initialValue?: string
    placeholder?: string
    onClose: () => void
    onSubmit: (name: string) => void
}) => {
    const [value, setValue] = useState(initialValue)

    useEffect(() => {
        if (open) setValue(initialValue)
    }, [open, initialValue])

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description ? <DialogDescription>{description}</DialogDescription> : null}
                </DialogHeader>
                <div>
                    <Input
                        autoFocus
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={placeholder}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        disabled={pending || !value.trim()}
                        onClick={() => onSubmit(value.trim())}
                    >
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
