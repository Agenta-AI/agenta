import {useState} from "react"

import type {AgentSecretBinding} from "@agenta/entities/secret"
import {commitAgentCredentialsAtom, workflowMolecule} from "@agenta/entities/workflow"
import type {ClientToolMeta} from "@agenta/shared/clientTools"
import {Button} from "@agenta/ui/ui"
import {Key} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AgentSecretAttachmentDrawer} from "../secret"

interface SecretRequestDockProps {
    meta: ClientToolMeta
    revisionId: string
    canEditSecrets?: boolean
    onAdoptRevision: (revisionId: string) => void
    onOutput: (args: {
        toolName: string
        toolCallId: string
        output: Record<string, unknown>
    }) => void
}

export const SecretRequestDock = ({
    meta,
    revisionId,
    canEditSecrets = false,
    onAdoptRevision,
    onOutput,
}: SecretRequestDockProps) => {
    const [targetId, setTargetId] = useState(revisionId)
    const [open, setOpen] = useState(false)
    const [settling, setSettling] = useState(false)
    const commit = useSetAtom(commitAgentCredentialsAtom)
    const configuration = useAtomValue(workflowMolecule.selectors.configuration(targetId))
    const dirty = useAtomValue(workflowMolecule.selectors.isDirty(targetId))
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(targetId))
    const variantLabel = useAtomValue(workflowMolecule.selectors.variantLabel(targetId))
    const entity = useAtomValue(workflowMolecule.selectors.data(targetId))
    const agent = configuration?.agent as
        | {sandbox?: {credentials?: AgentSecretBinding[]}}
        | undefined
    const bindings = agent?.sandbox?.credentials ?? []
    const input = meta.input as {name?: unknown; env_var?: unknown; reason?: unknown} | undefined
    const valid =
        typeof input?.name === "string" &&
        typeof input?.env_var === "string" &&
        typeof input?.reason === "string"
    const request = valid
        ? {
              name: input.name as string,
              envVar: input.env_var as string,
              reason: input.reason as string,
          }
        : undefined
    const label = [artifactName, variantLabel].filter(Boolean).join(" / ") || "This agent"
    const existingIndex = request
        ? bindings.findIndex((item) => item.binding.name === request.envVar)
        : -1
    const existing = existingIndex >= 0 ? bindings[existingIndex] : undefined
    const settle = (output: Record<string, unknown>) => {
        if (settling || meta.settled) return
        setSettling(true)
        onOutput({toolName: meta.toolName, toolCallId: meta.toolCallId, output})
    }
    const configured = (slug: string, envVar: string, nextRevisionId: string) => {
        onAdoptRevision(nextRevisionId)
        settle({status: "configured", secret: {slug}, env_var: envVar, revision_id: nextRevisionId})
    }
    return (
        <>
            <div
                className="rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 text-colorText"
                role="region"
                aria-label="Secret request"
            >
                <div className="flex items-center gap-2 text-xs font-medium">
                    <Key size={14} />
                    The agent is waiting for you
                </div>
                <p className="mb-1 mt-3 text-sm">
                    <strong>{request?.name ?? "Secret setup unavailable"}</strong>
                    {request
                        ? ` · ${request.reason}`
                        : "This request is missing its setup details."}
                </p>
                <p className="mb-3 text-xs text-colorTextSecondary">
                    {existing
                        ? "This secret is attached. Continue with the saved configuration."
                        : `Available for future runs of ${label}.`}
                </p>
                <div className="flex justify-end gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={settling}
                        onClick={() => settle({status: "cancelled"})}
                    >
                        Not now
                    </Button>
                    {existing ? (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={settling || dirty || !canEditSecrets}
                                onClick={() => setOpen(true)}
                            >
                                Configure
                            </Button>
                            <Button
                                size="sm"
                                disabled={settling || dirty}
                                onClick={() =>
                                    configured(
                                        existing.secret.slug,
                                        existing.binding.name,
                                        targetId,
                                    )
                                }
                            >
                                Continue
                            </Button>
                        </>
                    ) : (
                        <Button
                            size="sm"
                            disabled={!valid || settling || !canEditSecrets}
                            onClick={() => setOpen(true)}
                        >
                            Configure
                        </Button>
                    )}
                </div>
                {existing && !canEditSecrets ? (
                    <p className="mb-0 mt-2 text-right text-xs text-colorTextSecondary">
                        You do not have permission to change this secret attachment.
                    </p>
                ) : null}
            </div>
            <AgentSecretAttachmentDrawer
                open={open}
                onClose={() => setOpen(false)}
                target={{revisionId: targetId, label}}
                request={request}
                bindings={bindings}
                baseRevisionId={targetId}
                editingBinding={existing ? {index: existingIndex, value: existing} : undefined}
                dirty={dirty}
                disabled={!entity || !canEditSecrets}
                canCreateSecret={canEditSecrets}
                commitBinding={async ({baseRevisionId, secretSlug, envVar, editIndex}) => {
                    const binding = {
                        secret: {slug: secretSlug},
                        binding: {type: "env" as const, name: envVar},
                    }
                    const nextBindings =
                        editIndex === undefined
                            ? [...bindings, binding]
                            : bindings.map((item, index) => (index === editIndex ? binding : item))
                    const result = await commit({
                        revisionId: baseRevisionId,
                        bindings: nextBindings,
                    })
                    setTargetId(result.revisionId)
                    return result
                }}
                onAttached={({secretSlug, envVar, revisionId: next}) =>
                    configured(secretSlug, envVar, next)
                }
            />
        </>
    )
}
