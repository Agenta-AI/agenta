import {useEffect, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

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
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) onClose()
            }}
        >
            <SheetContent side="bottom">
                <SheetHeader>
                    <SheetTitle>{provider?.title ?? "Provider"} API key</SheetTitle>
                    <SheetDescription>
                        Stored in this project&apos;s vault and never shown in full again.
                    </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-3 px-4">
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

                <SheetFooter>
                    <Button disabled={!key.trim() || saving} onClick={submit}>
                        {saving ? "Saving…" : "Save key"}
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
