import {useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import type {LlmProvider} from "@agenta/shared/types"
import {CheckCircle} from "@phosphor-icons/react"
import {Button, Input, Typography} from "antd"

/**
 * "Provider key" content for the Model & credentials drawer — a key/value pair: a disabled input naming
 * the provider's vault key (e.g. `OPENAI_API_KEY`) beside the secret input for its value. Shows a
 * "connect your key" state when the selected model's provider has no vault key, or a "configured ·
 * replace" state when it does. Saves to the project vault (standard path) + refetches, so the key lands
 * without leaving the playground and the chat gate clears reactively.
 */
const ProviderKeyField = ({provider}: {provider: LlmProvider}) => {
    const {handleModifyVaultSecret} = useVaultSecret()
    const [key, setKey] = useState("")
    const [saving, setSaving] = useState(false)

    const save = async () => {
        const trimmed = key.trim()
        if (!trimmed || saving) return
        setSaving(true)
        try {
            await handleModifyVaultSecret({...provider, key: trimmed})
            setKey("")
        } finally {
            setSaving(false)
        }
    }

    const hasKey = !!provider.key
    const keyName = provider.name ?? provider.title ?? "PROVIDER_API_KEY"

    return (
        <div className="flex flex-col gap-2 py-0.5">
            {hasKey ? (
                <Typography.Text className="!inline-flex !items-center !gap-1 !text-[11px] !text-[var(--ag-colorSuccess)]">
                    <CheckCircle size={13} weight="fill" />
                    Key configured · enter a new value to replace it.
                </Typography.Text>
            ) : (
                <Typography.Text type="secondary" className="!text-[11px] !leading-snug">
                    Standard provider · add your key and we'll run this agent with it.
                </Typography.Text>
            )}
            <div className="flex items-center gap-2">
                <Input disabled value={keyName} className="w-[42%] shrink-0" />
                <Input.Password
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onPressEnter={save}
                    placeholder={hasKey ? "Enter a new API key" : "Enter your API key"}
                    className="flex-1"
                    autoFocus={!hasKey}
                />
                <Button type="primary" onClick={save} loading={saving} disabled={!key.trim()}>
                    {hasKey ? "Replace" : "Save"}
                </Button>
            </div>
            <Typography.Text type="secondary" className="!text-[11px]">
                Encrypted in transit and at rest.
            </Typography.Text>
        </div>
    )
}

export default ProviderKeyField
