import {useCallback, useMemo, useState} from "react"

import {
    createVaultSecretMutationAtom,
    deleteVaultSecretMutationAtom,
    SecretKind,
    McpStandardProviderKind,
    updateVaultSecretMutationAtom,
    vaultSecretsQueryAtom,
    type CreateSecretDto,
} from "@agenta/entities/secret"
import {message} from "@agenta/ui"
import {Button, Card, Input, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

const ComposioProjectKey = () => {
    const projectId = useAtomValue(projectIdAtom)
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const createSecret = useAtomValue(createVaultSecretMutationAtom)
    const updateSecret = useAtomValue(updateVaultSecretMutationAtom)
    const deleteSecret = useAtomValue(deleteVaultSecretMutationAtom)
    const [key, setKey] = useState("")

    const existing = useMemo(
        () =>
            vaultQuery.data?.find(
                (secret) =>
                    secret.type === SecretKind.ProviderKey && secret.name === "COMPOSIO_API_KEY",
            ),
        [vaultQuery.data],
    )

    const payload = useCallback(
        (value: string): CreateSecretDto => ({
            header: {name: "Composio"},
            secret: {
                kind: SecretKind.ProviderKey,
                data: {
                    kind: McpStandardProviderKind.Composio,
                    provider: {key: value},
                },
            },
        }),
        [],
    )

    const save = useCallback(async () => {
        if (!projectId || !key.trim()) return
        try {
            if (existing?.id) {
                await updateSecret.mutateAsync({
                    projectId,
                    secret_id: existing.id,
                    payload: payload(key.trim()),
                })
            } else {
                await createSecret.mutateAsync({projectId, payload: payload(key.trim())})
            }
            setKey("")
            await vaultQuery.refetch()
            message.success("Composio project key saved.")
        } catch (error) {
            message.error((error as Error).message || "Failed to save the Composio project key.")
        }
    }, [createSecret, existing?.id, key, payload, projectId, updateSecret, vaultQuery])

    const remove = useCallback(async () => {
        if (!projectId || !existing?.id) return
        try {
            await deleteSecret.mutateAsync({projectId, secret_id: existing.id})
            await vaultQuery.refetch()
            message.success("Composio project key removed.")
        } catch (error) {
            message.error((error as Error).message || "Failed to remove the Composio project key.")
        }
    }, [deleteSecret, existing?.id, projectId, vaultQuery])

    return (
        <Card
            size="small"
            title="Composio"
            extra={
                <Tag color={existing?.id ? "success" : "default"}>
                    {existing?.id ? "Connected" : "Not connected"}
                </Tag>
            }
        >
            <div className="flex flex-col gap-3">
                <Typography.Text type="secondary">
                    Use your project’s Composio developer key for the standard Composio MCP gateway.
                    It is stored in this project’s vault and never sent to an agent or runner.
                </Typography.Text>
                <div className="flex gap-2">
                    <Input.Password
                        value={key}
                        onChange={(event) => setKey(event.target.value)}
                        placeholder={existing?.id ? "Enter a replacement key" : "Composio API key"}
                        autoComplete="off"
                    />
                    <Button
                        type="primary"
                        onClick={save}
                        disabled={!projectId || !key.trim()}
                        loading={createSecret.isPending || updateSecret.isPending}
                    >
                        {existing?.id ? "Replace key" : "Save key"}
                    </Button>
                    {existing?.id && (
                        <Button danger onClick={remove} loading={deleteSecret.isPending}>
                            Remove
                        </Button>
                    )}
                </div>
            </div>
        </Card>
    )
}

export default ComposioProjectKey
