import {useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    PasswordInput,
} from "@agenta/ui/ui"

export interface McpTokenSignInDialogProps {
    open: boolean
    /** The server's name, for the title. */
    serverName: string
    /** Stores the person's token; resolves true when it is saved. */
    onSubmit: (token: string) => Promise<boolean>
    onClose: () => void
    /** Why the last try did not save, in words a person can read. */
    error?: string | null
}

/** A token server's personal sign-in: the person pastes their own token. */
export const McpTokenSignInDialog = ({
    open,
    serverName,
    onSubmit,
    onClose,
    error,
}: McpTokenSignInDialogProps) => {
    const [token, setToken] = useState("")
    const [saving, setSaving] = useState(false)

    const close = () => {
        setToken("")
        onClose()
    }

    const submit = async () => {
        if (!token.trim()) return
        setSaving(true)
        try {
            if (await onSubmit(token.trim())) close()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) close()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Sign in to {serverName}</DialogTitle>
                    <DialogDescription>
                        Paste your own token for this server. Only runs you start use it.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-1.5"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void submit()
                    }}
                >
                    <span className="text-sm font-medium text-foreground">Token</span>
                    <PasswordInput
                        autoFocus
                        autoComplete="off"
                        aria-label="Token"
                        value={token}
                        onValueChange={setToken}
                    />
                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                </form>
                <DialogFooter>
                    <Button variant="outline" onClick={close} disabled={saving}>
                        Cancel
                    </Button>
                    <Button disabled={!token.trim() || saving} onClick={() => void submit()}>
                        {saving ? "Signing in…" : "Sign in"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
