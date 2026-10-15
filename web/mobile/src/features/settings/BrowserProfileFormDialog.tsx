import {useEffect, useState} from "react"

import {
    parseAllowedHosts,
    type BrowserProfile,
    type BrowserProfileInput,
} from "@agenta/entities/browserProfile"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Textarea,
} from "@agenta/ui/ui"

import {Field} from "./Field"

export const BrowserProfileFormDialog = ({
    open,
    profile,
    pending,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean
    /** The login being edited; absent when creating. */
    profile?: BrowserProfile | null
    pending: boolean
    error?: string | null
    onClose: () => void
    onSubmit: (input: BrowserProfileInput) => void
}) => {
    const [name, setName] = useState("")
    const [sites, setSites] = useState("")

    useEffect(() => {
        if (!open) return
        setName(profile?.name ?? "")
        setSites(profile?.allowed_hosts.join("\n") ?? "")
    }, [open, profile])

    const hosts = parseAllowedHosts(sites)
    const canSubmit = name.trim().length > 0 && hosts.length > 0 && !pending

    return (
        <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {profile ? "Edit browser login" : "Add browser login"}
                    </DialogTitle>
                    <DialogDescription>
                        The browser only opens the sites you list. Agenta stores the cookies from
                        your login, never your password.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (canSubmit) onSubmit({name: name.trim(), allowed_hosts: hosts})
                    }}
                >
                    <Field label="Name">
                        <Input
                            autoFocus
                            value={name}
                            placeholder="Work GitHub"
                            onChange={(event) => setName(event.target.value)}
                        />
                    </Field>
                    <Field
                        label="Sites"
                        hint="One site per line, or separated by commas. A site also allows its subdomains."
                    >
                        <Textarea
                            rows={4}
                            value={sites}
                            placeholder={"app.codecov.io\ngithub.com"}
                            onChange={(event) => setSites(event.target.value)}
                        />
                    </Field>
                    {error ? (
                        <p role="alert" className="text-destructive m-0 text-xs">
                            {error}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canSubmit}>
                            {pending ? "Saving…" : profile ? "Save" : "Add login"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
