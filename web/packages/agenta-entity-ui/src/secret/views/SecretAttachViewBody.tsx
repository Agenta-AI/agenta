import {useCallback, useMemo, useState} from "react"

import {useDrillInUI} from "@agenta/editor/drill-in"
import {commitAgentCredentialsAtom, workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentSecretsCatalog from "@agenta/i18n/catalogs/entityUi.agentSecrets"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue, useSetAtom} from "jotai"

import {useAgentConfigWriter} from "../../DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter"
import {RemovedItemState} from "../../DrillInView/SchemaControls/agentTemplate/views/RemovedItemState"
import {RemoveFromAgentDialog} from "../../DrillInView/SchemaControls/agentTemplate/views/RemoveFromAgentDialog"
import {RemoveFromAgentFooter} from "../../DrillInView/SchemaControls/agentTemplate/views/RemoveFromAgentFooter"
import {SecretAttachFields} from "../attach/SecretAttachFields"
import {useSecretAttachForm, type SecretAttachFormOptions} from "../attach/useSecretAttachForm"
import {findSecretBinding, readSecretBindings} from "../secretBindings"

import type {SecretAttachViewParams} from "./secretAttachView"

const SecretAttachViewBody = ({params, target, nav}: ViewProps<SecretAttachViewParams>) => {
    const t = useT(secretAttachmentCatalog, secretViewsCatalog, agentSecretsCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {permissions, onWorkflowRevisionCommitted} = useDrillInUI()
    const canEditSecrets = permissions?.canEditSecrets ?? false
    const commit = useSetAtom(commitAgentCredentialsAtom)
    const agentDirty = useAtomValue(workflowMolecule.selectors.isDirty(writer.revisionId))
    const bindings = useMemo(() => readSecretBindings(writer.agent), [writer.agent])
    // Found by its variable in the list as it is now, so a builder save under the open view never
    // puts another attachment here.
    const editing = params.envVar ? findSecretBinding(bindings, params.envVar) : undefined
    const committed = !writer.revisionId.startsWith("local-")
    useViewTitle(t("entityUi.secretAttachment.attachTitle"))

    const commitBinding = useCallback<SecretAttachFormOptions["commitBinding"]>(
        async ({baseRevisionId, credential, editIndex}) => {
            if (!committed) throw new Error(t("entityUi.agentSecrets.saveAgentFirst"))
            const next = [...bindings]
            if (editIndex === undefined) next.push(credential)
            else next[editIndex] = credential
            const result = await commit({revisionId: baseRevisionId, bindings: next})
            onWorkflowRevisionCommitted?.(result.revisionId)
            return result
        },
        [bindings, commit, committed, onWorkflowRevisionCommitted, t],
    )

    const form = useSecretAttachForm({
        open: true,
        revisionId: writer.revisionId,
        bindings,
        editingBinding: editing,
        dirty: agentDirty,
        disabled: writer.readOnly || !canEditSecrets,
        canCreateSecret: canEditSecrets,
        commitBinding,
    })

    useViewForm({
        // Never dirty: leaving asks nothing and drops the draft, as the MCP connect view does.
        dirty: false,
        saveWhenClean: true,
        valid: form.canSubmit,
        save: form.submit,
        saveLabel: form.submitLabel,
    })

    // "Remove from agent": saves a version without this attachment; the dialog keeps a failure.
    const [confirming, setConfirming] = useState(false)
    const [removePending, setRemovePending] = useState(false)
    const [removeError, setRemoveError] = useState<string | null>(null)
    const remove = async () => {
        if (!params.envVar || removePending) return
        setRemovePending(true)
        setRemoveError(null)
        try {
            if (agentDirty) throw new Error(t("entityUi.agentSecrets.saveOrDiscardFirst"))
            const result = await commit({
                revisionId: writer.revisionId,
                bindings: bindings.filter((binding) => binding.binding.name !== params.envVar),
            })
            onWorkflowRevisionCommitted?.(result.revisionId)
            setConfirming(false)
            nav.cancel()
        } catch (cause) {
            setRemoveError(
                cause instanceof Error ? cause.message : t("entityUi.agentSecrets.unableToRemove"),
            )
        } finally {
            setRemovePending(false)
        }
    }

    if (params.envVar && !editing) {
        return (
            <RemovedItemState
                message={t("entityUi.secretViews.removedState")}
                onBack={() => void nav.back()}
            />
        )
    }

    return (
        <div className="flex flex-col gap-3 px-4 py-3">
            {!canEditSecrets ? (
                <div className="rounded-lg border border-border-muted p-3 text-meta text-muted-foreground">
                    {t("entityUi.agentSecrets.needPermission")}
                </div>
            ) : null}
            <SecretAttachFields form={form} agentDirty={agentDirty} />
            {editing && committed && canEditSecrets && !writer.readOnly ? (
                <RemoveFromAgentFooter onClick={() => setConfirming(true)} />
            ) : null}
            <RemoveFromAgentDialog
                open={confirming}
                name={params.envVar ?? ""}
                body={t("entityUi.agentSecrets.removeAttachmentBody")}
                pending={removePending}
                error={removeError}
                onConfirm={() => void remove()}
                onCancel={() => {
                    setRemoveError(null)
                    setConfirming(false)
                }}
            />
        </div>
    )
}

export default SecretAttachViewBody
