import {useCallback, useEffect, useRef, useState} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {useToolsConnections, type CreateConnectionInput} from "./hooks/useToolsConnections"

interface Props {
    open: boolean
    integrationKey: string
    integrationName: string
    authSchemes: string[]
    onClose: () => void
}

type AuthMode = "oauth" | "api_key"

function resolveAvailableModes(authSchemes: string[]): AuthMode[] {
    const modes: AuthMode[] = []
    if (authSchemes.some((s) => s.toLowerCase().includes("oauth"))) modes.push("oauth")
    if (
        authSchemes.some(
            (s) => s.toLowerCase().includes("api_key") || s.toLowerCase().includes("basic"),
        )
    )
        modes.push("api_key")
    if (modes.length === 0) modes.push("oauth")
    return modes
}

export default function ConnectModal({
    open,
    integrationKey,
    integrationName,
    authSchemes,
    onClose,
}: Props) {
    const {handleCreate, invalidate} = useToolsConnections(integrationKey)
    const [loading, setLoading] = useState(false)
    const [slug, setSlug] = useState("")
    const [name, setName] = useState("")
    const [slugError, setSlugError] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)

    /** The OAuth popup watcher. Held in a ref so unmount and a retry can both stop it. */
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const clearPoll = useCallback(() => {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
    }, [])
    useEffect(() => clearPoll, [clearPoll])

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        clearPoll()
        setSlug("")
        setName("")
        setSlugError(null)
        setCreateError(null)
        setLoading(false)
        onClose()
    }, [clearPoll, onClose])

    const handleSubmit = useCallback(async () => {
        if (!slug.trim()) {
            setSlugError("Required")
            return
        }
        setSlugError(null)
        setCreateError(null)

        try {
            setLoading(true)

            const payload: CreateConnectionInput = {
                slug: slug.trim(),
                name: name.trim() || slug.trim(),
                mode: selectedMode,
            }

            const result = await handleCreate(payload)
            const redirectUrl =
                typeof result.connection?.data?.redirect_url === "string"
                    ? result.connection.data.redirect_url
                    : undefined

            if (redirectUrl) {
                // OAuth and API key both authorize on the provider's hosted redirect UI.
                const popup = window.open(
                    redirectUrl,
                    "tools_oauth",
                    "width=600,height=700,popup=yes",
                )

                if (!popup) {
                    setLoading(false)
                    return
                }

                // Tracked so unmounting the modal (or starting a second connect) stops the
                // poll — an untracked interval outlives the dialog and keeps polling a popup
                // handle nobody is watching.
                clearPoll()
                pollRef.current = setInterval(() => {
                    if (popup.closed) {
                        clearPoll()
                        window.focus()
                        invalidate()
                        handleClose()
                    }
                }, 1000)
            } else {
                // No-auth toolkit: connection created immediately, no redirect.
                handleClose()
            }
        } catch (error) {
            setLoading(false)
            setCreateError(
                error instanceof Error ? error.message : "Couldn't create the connection",
            )
        }
    }, [slug, name, selectedMode, clearPoll, handleCreate, handleClose, invalidate])

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : handleClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect to {integrationName}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <Field
                        label="Connection Slug"
                        required
                        tooltip="A unique identifier for this connection"
                        error={slugError}
                    >
                        <Input
                            value={slug}
                            onChange={(event) => setSlug(event.target.value)}
                            placeholder="e.g. my-gmail"
                        />
                    </Field>

                    <Field label="Display Name">
                        <Input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="e.g. My Gmail Account"
                        />
                    </Field>

                    {availableModes.length > 1 && (
                        <Field label="Auth Method">
                            <Select
                                value={selectedMode}
                                onValueChange={(value) => setSelectedMode(value as AuthMode)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableModes.map((mode) => (
                                        <SelectItem key={mode} value={mode}>
                                            {mode === "oauth" ? "OAuth" : "API Key"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    )}

                    {createError ? (
                        <p role="alert" className="m-0 text-xs text-colorError">
                            {createError}
                        </p>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button disabled={loading} onClick={() => void handleSubmit()}>
                        {selectedMode === "oauth" ? "Connect via OAuth" : "Connect"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
