import {useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {CheckCircle} from "@phosphor-icons/react"
import {App, Button, Input, Typography} from "antd"

/**
 * Right-pane "API key" form for a standard provider — the Provider credentials section's key form
 * (evolved from the original Model & credentials drawer field, same immediate-save semantics): a
 * heading + subtitle, "API key *" input, Save/Replace, a masked "configured" state when a key
 * exists, and an encryption footnote. Saves to the project vault via `useVaultSecret`, which also
 * arms `providerKeySetupDoneAtom` — no drawer Save step, so the "Connect key" gate clears reactively.
 */
const ProviderKeyField = ({provider, disabled}: {provider: LlmProvider; disabled?: boolean}) => {
    const {message} = App.useApp()
    const {handleModifyVaultSecret} = useVaultSecret()
    const [key, setKey] = useState("")
    const [saving, setSaving] = useState(false)

    const save = async () => {
        const trimmed = key.trim()
        if (!trimmed || saving || disabled) return
        setSaving(true)
        try {
            await handleModifyVaultSecret({...provider, key: trimmed})
            setKey("")
        } catch {
            // Security-sensitive write — never fail silently; keep the typed value so the user can retry.
            message.error("Couldn't save the provider key. Please try again.")
        } finally {
            setSaving(false)
        }
    }

    const hasKey = !!provider.key

    return (
        <div className="flex flex-col gap-2 py-0.5">
            <Typography.Text className="!text-[14.5px] !font-semibold">
                {provider.title}
            </Typography.Text>
            <Typography.Text type="secondary" className="!text-xs !leading-snug">
                Standard provider · add your key and we auto-list its models.
            </Typography.Text>
            {hasKey ? (
                <Typography.Text className="!inline-flex !items-center !gap-1 !text-[11px] !text-[var(--ag-colorSuccess)]">
                    <CheckCircle size={13} weight="fill" />
                    Key configured · enter a new value to replace it.
                </Typography.Text>
            ) : null}
            <div className="flex flex-col gap-1">
                <Typography.Text className="!text-xs !font-medium">
                    API key <span className="text-[var(--ag-colorError)]">*</span>
                </Typography.Text>
                <div className="flex items-center gap-2">
                    <Input.Password
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        onPressEnter={save}
                        placeholder="sk-…"
                        className="flex-1 font-mono"
                        autoFocus={!hasKey}
                        disabled={disabled}
                    />
                    <Button
                        type="primary"
                        onClick={save}
                        loading={saving}
                        disabled={disabled || !key.trim()}
                    >
                        {hasKey ? "Replace" : "Save"}
                    </Button>
                </div>
            </div>
            <Typography.Text type="secondary" className="!text-[11px]">
                This secret is encrypted in transit and at rest.
            </Typography.Text>
        </div>
    )
}

export default ProviderKeyField
