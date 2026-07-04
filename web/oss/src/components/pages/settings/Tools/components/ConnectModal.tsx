import {useCallback, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Form, FormField, useAppForm} from "@agenta/primitive-ui/components/form"
import {Input} from "@agenta/primitive-ui/components/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {z} from "zod"

import {useToolsConnections, type CreateConnectionInput} from "../hooks/useToolsConnections"

interface Props {
    open: boolean
    integrationKey: string
    integrationName: string
    authSchemes: string[]
    onClose: () => void
}

type AuthMode = "oauth" | "api_key"

const connectSchema = z.object({
    slug: z.string().min(1, "Required"),
    name: z.string().optional(),
})

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
    const form = useAppForm({schema: connectSchema, defaultValues: {slug: "", name: ""}})

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        form.reset()
        setLoading(false)
        onClose()
    }, [form, onClose])

    const handleSubmit = useCallback(
        async (values: z.input<typeof connectSchema>) => {
            try {
                setLoading(true)

                const payload: CreateConnectionInput = {
                    slug: values.slug,
                    name: values.name || values.slug,
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
        },
        [selectedMode, handleCreate, handleClose, invalidate],
    )

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect to {integrationName}</DialogTitle>
                </DialogHeader>
                <Form id="connect-tool-form" form={form} onSubmit={handleSubmit} className="mt-4">
                    <FormField
                        name="slug"
                        label="Connection Slug"
                        description="A unique identifier for this connection"
                    >
                        {(field) => <Input {...field} placeholder="e.g. my-gmail" />}
                    </FormField>

                    <FormField name="name" label="Display Name">
                        {(field) => <Input {...field} placeholder="e.g. My Gmail Account" />}
                    </FormField>

                    {availableModes.length > 1 && (
                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Auth Method</span>
                            <Select
                                value={selectedMode}
                                onValueChange={(v) => setSelectedMode(v as AuthMode)}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableModes.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m === "oauth" ? "OAuth" : "API Key"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </Form>
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button type="submit" form="connect-tool-form" disabled={loading}>
                        {loading ? <Spinner /> : null}
                        {selectedMode === "oauth" ? "Connect via OAuth" : "Connect"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
