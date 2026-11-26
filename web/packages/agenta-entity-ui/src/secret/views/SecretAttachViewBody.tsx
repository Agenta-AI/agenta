import {useCallback, useMemo} from "react"

import {commitAgentCredentialsAtom, workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentSecretsCatalog from "@agenta/i18n/catalogs/entityUi.agentSecrets"
import secretAttachmentCatalog from "@agenta/i18n/catalogs/entityUi.secretAttachment"
import secretViewsCatalog from "@agenta/i18n/catalogs/entityUi.secretViews"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue, useSetAtom} from "jotai"

import {useAgentConfigWriter} from "../../DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter"
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
        dirty: form.dirty,
        valid: form.canSubmit,
        save: form.submit,
        leaveDescription: t("entityUi.secretViews.attachLeaveDescription"),
        saveLabel: form.submitLabel,
    })

    if (params.envVar && !editing) {
        return (
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
                <span className="text-colorTextSecondary">
                    {t("entityUi.secretViews.removedState")}
                </span>
                <Button variant="outline" size="sm" onClick={() => void nav.back()}>
                    {t("entityUi.secretViews.back")}
                </Button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3 px-4 py-3">
            {!canEditSecrets ? (
                <div className="rounded-lg border border-colorBorderSecondary p-3 text-xs text-colorTextSecondary">
                    {t("entityUi.agentSecrets.needPermission")}
                </div>
            ) : null}
            <SecretAttachFields form={form} agentDirty={agentDirty} />
        </div>
    )
}

export default SecretAttachViewBody
