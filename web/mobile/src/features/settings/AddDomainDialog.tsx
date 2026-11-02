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

import {plainAccessError} from "./accessErrors"
import {Field} from "./Field"

/** Add a domain: the backend returns the token that the DNS instructions show. */
export const AddDomainDialog = ({
    open,
    onClose,
    onSubmit,
}: {
    open: boolean
    onClose: () => void
    onSubmit: (domain: string) => Promise<void>
}) => {
    const [domain, setDomain] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setDomain("")
        setPending(false)
        setError(null)
    }, [open])

    const submit = async () => {
        const value = domain.trim()
        if (!value) {
            setError("Enter a domain name")
            return
        }
        setPending(true)
        setError(null)
        try {
            await onSubmit(value)
            onClose()
        } catch (cause) {
            setError(plainAccessError(cause, "Could not add the domain"))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add domain</DialogTitle>
                    <DialogDescription>
                        Add a domain, then publish its DNS TXT record to prove ownership.
                    </DialogDescription>
                </DialogHeader>
                <Field label="Domain" hint="For example, company.com">
                    <Input
                        autoFocus
                        value={domain}
                        placeholder="company.com"
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => setDomain(event.target.value)}
                    />
                </Field>
                {error ? (
                    <p role="alert" className="text-destructive m-0 text-xs">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button disabled={pending || !domain.trim()} onClick={() => void submit()}>
                        {pending ? "Adding…" : "Add domain"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
