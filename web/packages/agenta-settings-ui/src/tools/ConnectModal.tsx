import {useCallback, useEffect, useRef, useState} from "react"

import {
    useToolConnectionsQuery,
    useToolsConnections,
    type CreateConnectionInput,
} from "@agenta/entities/gatewayTool"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
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

    // The author names the connection; the slug is derived from it and never shown.
    const {connections} = useToolConnectionsQuery()
    const existingCount = connections.filter(
        (connection) => connection.integration_key === integrationKey,
    ).length
    const seedName = defaultConnectionName(integrationName, existingCount)
    const slugSuffixRef = useRef(randomAlphanumeric(3))
    const nameTouchedRef = useRef(false)

    const [name, setName] = useState(seedName)
    const [nameError, setNameError] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)

    useEffect(() => {
        if (!nameTouchedRef.current) setName(seedName)
    }, [seedName])

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
        nameTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setName(seedName)
        setNameError(null)
        setCreateError(null)
        setLoading(false)
        onClose()
    }, [clearPoll, onClose, seedName])

    const handleSubmit = useCallback(async () => {
        const trimmedName = name.trim()
        if (!trimmedName) {
            setNameError("Required")
            return
        }
        setNameError(null)
        setCreateError(null)

        try {
            setLoading(true)

            const payload: CreateConnectionInput = {
                slug: generateDefaultSlug(trimmedName, slugSuffixRef.current),
                name: trimmedName,
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
    }, [name, selectedMode, clearPoll, handleCreate, handleClose, invalidate])

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : handleClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect to {integrationName}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <Field
                        label="Name"
                        required
                        tooltip="Display name for this connection"
                        error={nameError}
                    >
                        <Input
                            value={name}
                            aria-invalid={nameError ? true : undefined}
                            onChange={(event) => {
                                nameTouchedRef.current = true
                                setName(event.target.value)
                                if (nameError && event.target.value.trim()) setNameError(null)
                            }}
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
