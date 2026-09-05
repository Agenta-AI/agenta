import {useMemo, useState} from "react"

import {CustomSecretFormat, useVaultSecret, type AgentSecretBinding} from "@agenta/entities/secret"
import {commitAgentCredentialsAtom, workflowMolecule} from "@agenta/entities/workflow"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Spinner,
} from "@agenta/ui/ui"
import {Key, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AgentSecretAttachmentDrawer} from "../../../secret"

export interface AgentSecretsSectionProps {
    revisionId?: string | null
    bindings: AgentSecretBinding[]
    disabled?: boolean
    localDraftDirty?: boolean
    canEditSecrets?: boolean
    onRevisionCommitted?: (revisionId: string) => void
}

export function AgentSecretsSection({
    revisionId,
    bindings,
    disabled = false,
    localDraftDirty = false,
    canEditSecrets = true,
    onRevisionCommitted,
}: AgentSecretsSectionProps) {
    const {namedSecrets, loading} = useVaultSecret()
    const commitCredentials = useSetAtom(commitAgentCredentialsAtom)
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(revisionId ?? ""))
    const variantLabel = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId ?? ""))
    const workflowDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId ?? ""))
    const dirty = workflowDirty || localDraftDirty
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [removeIndex, setRemoveIndex] = useState<number | null>(null)
    const [removing, setRemoving] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)

    const namesBySlug = useMemo(
        () =>
            new Map(
                namedSecrets
                    .filter((secret) => secret.format === CustomSecretFormat.Text)
                    .map((secret) => [secret.slug, secret.name]),
            ),
        [namedSecrets],
    )
    const targetLabel = [artifactName, variantLabel].filter(Boolean).join(" / ") || "Agent"
    const canAttach = Boolean(revisionId) && !disabled && canEditSecrets && !dirty

    const saveBindings = async (next: AgentSecretBinding[]) => {
        if (!revisionId) throw new Error("Save this agent before attaching a secret.")
        if (dirty) throw new Error("Save or discard the current agent changes first.")
        const result = await commitCredentials({revisionId, bindings: next})
        onRevisionCommitted?.(result.revisionId)
        return result
    }

    const commitBinding: React.ComponentProps<
        typeof AgentSecretAttachmentDrawer
    >["commitBinding"] = async ({secretSlug, envVar, editIndex}) => {
        const next = [...bindings]
        const value: AgentSecretBinding = {
            secret: {slug: secretSlug},
            binding: {type: "env", name: envVar},
        }
        if (editIndex === undefined) next.push(value)
        else next[editIndex] = value
        return saveBindings(next)
    }

    const remove = async () => {
        if (removeIndex === null || removing) return
        setRemoving(true)
        setRemoveError(null)
        try {
            await saveBindings(bindings.filter((_, index) => index !== removeIndex))
            setRemoveIndex(null)
        } catch (error) {
            setRemoveError(
                error instanceof Error ? error.message : "Unable to remove this attachment.",
            )
        } finally {
            setRemoving(false)
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
                <div className="text-xs leading-snug text-colorTextDescription">
                    Attach project vault secrets as environment variables for this agent.
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAttach}
                    onClick={() => {
                        setEditingIndex(null)
                        setDrawerOpen(true)
                    }}
                >
                    <Plus size={13} /> Attach
                </Button>
            </div>

            {!canEditSecrets ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    You need permission to edit project secrets before you can change attachments.
                </div>
            ) : dirty ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    Save or discard the current agent changes before changing secret attachments.
                </div>
            ) : null}

            {!revisionId ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    Save this agent before attaching a secret.
                </div>
            ) : loading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-colorTextSecondary">
                    <Spinner size="small" /> Loading secrets
                </div>
            ) : bindings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-colorBorderSecondary p-4 text-center text-xs text-colorTextSecondary">
                    No custom secrets attached.
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-colorBorderSecondary">
                    {bindings.map((binding, index) => {
                        const secretName = namesBySlug.get(binding.secret.slug)
                        return (
                            <div
                                key={`${binding.secret.slug}-${binding.binding.name}`}
                                className="flex items-center gap-3 border-b border-colorBorderSecondary px-3 py-2.5 last:border-b-0"
                            >
                                <Key size={16} className="shrink-0 text-colorTextSecondary" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-colorText">
                                        {binding.binding.name}
                                    </div>
                                    <div className="truncate text-xs text-colorTextSecondary">
                                        {secretName ?? `${binding.secret.slug} (unavailable)`}
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Edit ${binding.binding.name}`}
                                    disabled={disabled || !canEditSecrets || dirty}
                                    onClick={() => {
                                        setEditingIndex(index)
                                        setDrawerOpen(true)
                                    }}
                                >
                                    <PencilSimple size={14} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Remove ${binding.binding.name}`}
                                    disabled={disabled || !canEditSecrets || dirty}
                                    onClick={() => {
                                        setRemoveError(null)
                                        setRemoveIndex(index)
                                    }}
                                >
                                    <Trash size={14} />
                                </Button>
                            </div>
                        )
                    })}
                </div>
            )}

            {revisionId ? (
                <AgentSecretAttachmentDrawer
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    target={{revisionId, label: targetLabel}}
                    bindings={bindings}
                    baseRevisionId={revisionId}
                    editingBinding={
                        editingIndex === null
                            ? undefined
                            : {index: editingIndex, value: bindings[editingIndex]!}
                    }
                    dirty={dirty}
                    disabled={disabled || !canEditSecrets || dirty}
                    canCreateSecret={canEditSecrets}
                    commitBinding={commitBinding}
                />
            ) : null}

            <AlertDialog
                open={removeIndex !== null}
                onOpenChange={(open) => {
                    if (!open && !removing) {
                        setRemoveError(null)
                        setRemoveIndex(null)
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove this secret attachment?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The agent will lose access to this variable. The secret stays in the
                            project vault.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {removeError ? (
                        <div role="alert" className="text-sm text-colorError">
                            {removeError}
                        </div>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={removing || dirty}
                            onClick={(event) => {
                                event.preventDefault()
                                void remove()
                            }}
                        >
                            {removing ? "Removing..." : "Remove"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
