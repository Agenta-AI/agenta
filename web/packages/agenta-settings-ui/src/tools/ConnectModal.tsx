import {useCallback, useState} from "react"

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

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        setSlug("")
        setName("")
        setSlugError(null)
        setLoading(false)
        onClose()
    }, [onClose])

    const handleSubmit = useCallback(async () => {
        if (!slug.trim()) {
            setSlugError("Required")
            return
        }
        setSlugError(null)

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

                const pollTimer = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(pollTimer)
                        window.focus()
                        invalidate()
                        handleClose()
                    }
                }, 1000)
            } else {
                // No-auth toolkit: connection created immediately, no redirect.
                handleClose()
            }
        } catch {
            setLoading(false)
        }
    }, [slug, name, selectedMode, handleCreate, handleClose, invalidate])

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
