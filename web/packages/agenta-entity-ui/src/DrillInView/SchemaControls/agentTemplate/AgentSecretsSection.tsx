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
import {createPortal} from "react-dom"

import {AgentSecretAttachmentModal} from "../../../secret"

export interface AgentSecretsSectionProps {
    revisionId?: string | null
    bindings: AgentSecretBinding[]
    disabled?: boolean
    localDraftDirty?: boolean
    canEditSecrets?: boolean
    onRevisionCommitted?: (revisionId: string) => void
    /** Portal the Attach button into a host-owned element (e.g. a panel header) instead of the body. */
    attachContainer?: HTMLElement | null
}

export function AgentSecretsSection({
    revisionId,
    bindings,
    disabled = false,
    localDraftDirty = false,
    canEditSecrets = true,
    onRevisionCommitted,
    attachContainer,
}: AgentSecretsSectionProps) {
    const {namedSecrets, loading} = useVaultSecret()
    const commitCredentials = useSetAtom(commitAgentCredentialsAtom)
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(revisionId ?? ""))
    const workflowDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId ?? ""))
    const dirty = workflowDirty || localDraftDirty
    const [modalOpen, setModalOpen] = useState(false)
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
    // The agent's name alone: "default" told the reader nothing about which agent this is.
    const targetLabel = artifactName || "Agent"
    const committedRevision = Boolean(revisionId && !revisionId.startsWith("local-"))
    const canAttach = committedRevision && !disabled && canEditSecrets && !dirty

    const saveBindings = async (next: AgentSecretBinding[]) => {
        if (!committedRevision || !revisionId) {
            throw new Error("Save this agent before attaching a secret.")
        }
        if (dirty) throw new Error("Save or discard the current agent changes first.")
        const result = await commitCredentials({revisionId, bindings: next})
        onRevisionCommitted?.(result.revisionId)
        return result
    }

    const commitBinding: React.ComponentProps<
        typeof AgentSecretAttachmentModal
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

    const attachButton = (
        <Button
            size="sm"
            variant="outline"
            disabled={!canAttach}
            onClick={() => {
                setEditingIndex(null)
                setModalOpen(true)
            }}
        >
            <Plus size={13} /> Attach
        </Button>
    )

    return (
        <div className="flex flex-col gap-3">
            {attachContainer === undefined ? (
                <div className="flex items-center justify-end">{attachButton}</div>
            ) : attachContainer ? (
                createPortal(attachButton, attachContainer)
            ) : null}

            {!canEditSecrets ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    You need permission to edit project secrets before you can change attachments.
                </div>
            ) : dirty ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    Save or discard the current agent changes before changing secret attachments.
                </div>
            ) : null}

            {!committedRevision ? (
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
                // The subagent drawer's rows: a 34px tile, the name over its secret, the actions
                // trailing. No bordered box around the list.
                <div className="-ml-2 flex flex-col gap-0.5">
                    {bindings.map((binding, index) => {
                        const secretName = namesBySlug.get(binding.secret.slug)
                        return (
                            <div
                                key={`${binding.secret.slug}-${binding.binding.name}`}
                                className="flex items-center gap-3.5 rounded-[10px] py-2 pl-2"
                            >
                                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-control-sm bg-colorFillSecondary text-muted-foreground">
                                    <Key aria-hidden size={16} />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-px">
                                    <span className="truncate text-sm leading-[1.45] text-foreground">
                                        {binding.binding.name}
                                    </span>
                                    <span className="truncate text-[13px] leading-[1.45] text-muted-foreground">
                                        {secretName ?? `${binding.secret.slug} (unavailable)`}
                                    </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-0.5">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`Edit ${binding.binding.name}`}
                                        disabled={disabled || !canEditSecrets || dirty}
                                        onClick={() => {
                                            setEditingIndex(index)
                                            setModalOpen(true)
                                        }}
                                    >
                                        <PencilSimple size={14} />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="hover:bg-[color-mix(in_srgb,var(--ag-colorError)_10%,transparent)] hover:text-error"
                                        aria-label={`Remove ${binding.binding.name}`}
                                        disabled={disabled || !canEditSecrets || dirty}
                                        onClick={() => {
                                            setRemoveError(null)
                                            setRemoveIndex(index)
                                        }}
                                    >
                                        <Trash size={14} />
                                    </Button>
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}

            {revisionId ? (
                <AgentSecretAttachmentModal
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
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
