import {useEffect, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {Input} from "@/components/ui/input"

import {Field} from "./Field"

/** Set or replace a standard provider's API key. One field, the way the desktop modal is. */
export const ProviderKeySheet = ({
    open,
    provider,
    onClose,
}: {
    open: boolean
    provider: LlmProvider | null
    onClose: () => void
}) => {
    const {handleModifyVaultSecret} = useVaultSecret()
    const [key, setKey] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setKey(provider?.key ?? "")
        setError(null)
        setSaving(false)
    }, [open, provider])

    const submit = async () => {
        setSaving(true)
        setError(null)
        try {
            await handleModifyVaultSecret({
                name: provider?.name,
                id: provider?.id,
                title: provider?.title,
                key,
            })
            onClose()
        } catch (cause) {
            setError((cause as Error)?.message || "Could not save the key")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{provider?.title ?? "Provider"} API key</DialogTitle>
                    <DialogDescription>
                        Stored in this project&apos;s vault and never shown in full again.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <Field label="API key">
                        <Input
                            autoFocus
                            value={key}
                            onChange={(event) => setKey(event.target.value)}
                            placeholder="sk-…"
                            autoComplete="off"
                            spellCheck={false}
                            className="font-mono"
                        />
                    </Field>
                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button disabled={!key.trim() || saving} onClick={submit}>
                        {saving ? "Saving…" : "Save key"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
