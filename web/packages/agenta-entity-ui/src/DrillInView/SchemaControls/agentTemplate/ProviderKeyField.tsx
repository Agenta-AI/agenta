import {useEffect, useId, useRef, useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {providerKeyAddedSignalAtom} from "@agenta/shared/state"
import type {LlmProvider} from "@agenta/shared/types"
import {message} from "@agenta/ui/app-message"
import {useAccordionSectionOpen} from "@agenta/ui/components/presentational"
import {LoadingButton, PasswordInput} from "@agenta/ui/ui"
import {CheckCircle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Right-pane "API key" form for a standard provider — the Provider credentials section's key form
 * (evolved from the original Model & credentials drawer field, same immediate-save semantics): a
 * heading + subtitle, "API key *" input, Save/Replace, a masked "configured" state when a key
 * exists, and an encryption footnote. Saves to the project vault via `useVaultSecret`, which also
 * arms `providerKeySetupDoneAtom` — no drawer Save step, so the "Connect key" gate clears reactively.
 */
const ProviderKeyField = ({
    provider,
    disabled,
    hideHeader,
    revisionId,
}: {
    provider: LlmProvider
    disabled?: boolean
    /** Drop the name + "Standard provider · …" subtitle — used where a selected rail chip already
     * names the provider, so repeating it in the detail is noise. */
    hideHeader?: boolean
    /** The displayed revision, so a successful save can raise the "API key added" config-pane banner
     * scoped to it. */
    revisionId?: string | null
}) => {
    const {handleModifyVaultSecret} = useVaultSecret()
    const raiseKeyAddedSignal = useSetAtom(providerKeyAddedSignalAtom)
    const [key, setKey] = useState("")
    const [saving, setSaving] = useState(false)
    // Ours IS the HTMLInputElement — antd's InputRef.input indirection is gone.
    const inputRef = useRef<HTMLInputElement>(null)
    const inputId = useId()

    // Focus the key input when the enclosing section is open (and each time it re-opens), not just on
    // mount: the section body stays mounted while collapsed, so a mount-time `autoFocus` would fire
    // while hidden. Only when there's no key yet — an existing key isn't waiting to be typed.
    const sectionOpen = useAccordionSectionOpen()
    const hasKey = !!provider.key
    useEffect(() => {
        if (!sectionOpen || hasKey || disabled) return
        const t = window.setTimeout(() => inputRef.current?.focus(), 0)
        return () => window.clearTimeout(t)
    }, [sectionOpen, hasKey, disabled])

    const save = async () => {
        const trimmed = key.trim()
        if (!trimmed || saving || disabled) return
        const isFirstKey = !provider.key
        setSaving(true)
        try {
            await handleModifyVaultSecret({...provider, key: trimmed})
            setKey("")
            // Only the FIRST key connection unblocks the run — a replace doesn't need the banner.
            if (isFirstKey && revisionId) {
                raiseKeyAddedSignal({
                    revisionId,
                    provider: provider.title ?? provider.name ?? undefined,
                    at: Date.now(),
                })
            }
        } catch {
            // Security-sensitive write — never fail silently; keep the typed value so the user can retry.
            message.error("Couldn't save the provider key. Please try again.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {hideHeader ? (
                hasKey ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ag-colorSuccess)]">
                        <CheckCircle size={13} weight="fill" />
                        Key configured · enter a new value to replace it.
                    </span>
                ) : null
            ) : (
                <div className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">{provider.title}</span>
                    <span className="text-xs leading-snug text-colorTextDescription">
                        Standard provider · add your key and we auto-list its models.
                    </span>
                    {hasKey ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--ag-colorSuccess)]">
                            <CheckCircle size={13} weight="fill" />
                            Key configured · enter a new value to replace it.
                        </span>
                    ) : null}
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" htmlFor={inputId}>
                    API key <span className="text-[var(--ag-colorError)]">*</span>
                </label>
                <div className="flex items-center gap-2">
                    <PasswordInput
                        id={inputId}
                        ref={inputRef}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") save()
                        }}
                        placeholder="sk-…"
                        className="flex-1 font-mono"
                        disabled={disabled}
                    />
                    <LoadingButton
                        onClick={save}
                        loading={saving}
                        disabled={disabled || !key.trim()}
                    >
                        {hasKey ? "Replace" : "Save"}
                    </LoadingButton>
                </div>
                <span className="text-[11px] text-colorTextDescription">
                    This secret is encrypted in transit and at rest.
                </span>
            </div>
        </div>
    )
}

export default ProviderKeyField
