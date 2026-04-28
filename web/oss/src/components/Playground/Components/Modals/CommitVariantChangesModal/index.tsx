import {useCallback, useMemo, useState} from "react"

import {publishMutationAtom} from "@agenta/entities/runnable"
import {workflowMolecule, createWorkflowFromEphemeralAtom} from "@agenta/entities/workflow"
import {EntityCommitModal} from "@agenta/entity-ui"
import type {CommitSubmitParams, CommitCreateFieldsConfig} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {EnvironmentTag, environmentColors} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Checkbox, Select} from "antd"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import {
    evaluatorsPaginatedStore,
    clearEvaluatorWorkflowCache,
} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {
    registryPaginatedStore,
    clearRegistryVariantNameCache,
} from "@/oss/components/VariantsComponents/store/registryStore"
import {selectedAppIdAtom} from "@/oss/state/app"

import {CommitVariantChangesModalProps} from "./assets/types"

const EVALUATOR_CREATE_FIELDS: CommitCreateFieldsConfig = {nameLabel: "Evaluator name"}
const APP_CREATE_FIELDS: CommitCreateFieldsConfig = {nameLabel: "App name"}
const VARIANT_CREATE_FIELDS: CommitCreateFieldsConfig = {
    modes: ["variant"],
    nameLabel: "Variant name",
}

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    onSuccess,
    ...props
}) => {
    const {onCancel, open} = props

    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isEphemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(variantId || ""))
    const isEvaluator = useAtomValue(workflowMolecule.selectors.isEvaluator(variantId || ""))
    const isApplication = useAtomValue(workflowMolecule.selectors.isApplication(variantId || ""))

    const appId = useAtomValue(selectedAppIdAtom)
    const commitRevision = useSetAtom(playgroundController.actions.commitRevision)
    const createVariant = useSetAtom(playgroundController.actions.createVariant)
    const createFromEphemeral = useSetAtom(createWorkflowFromEphemeralAtom)
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)

    const [shouldDeploy, setShouldDeploy] = useState(false)
    const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null)

    const variantName = runnableData?.name || "Variant"
    const variantSlug = runnableData?.slug

    const environmentOptions = useMemo(
        () =>
            (Object.keys(environmentColors) as (keyof typeof environmentColors)[]).map((env) => ({
                value: env,
                label: <EnvironmentTag environment={env} />,
            })),
        [],
    )

    const handleClose = useCallback(() => {
        onCancel?.({} as never)
        setShouldDeploy(false)
        setSelectedEnvironment(null)
    }, [onCancel])

    const handleSubmit = useCallback(
        async ({
            message: commitMessage,
            mode,
            entityName: editedName,
            entitySlug: editedSlug,
        }: CommitSubmitParams) => {
            // Ephemeral entities: create a new workflow via the entities package reducer
            if (isEphemeral) {
                const result = await createFromEphemeral({
                    revisionId: variantId,
                    commitMessage,
                    name: editedName,
                    slug: editedSlug,
                })

                if (!result.success) {
                    const errorStatus = (result.error as {response?: {status?: number}}).response
                        ?.status
                    return {
                        success: false,
                        error:
                            "error" in result ? result.error.message : "Failed to create workflow",
                        errorStatus,
                    }
                }

                clearRegistryVariantNameCache()
                clearEvaluatorWorkflowCache()
                getDefaultStore().set(registryPaginatedStore.actions.refresh)
                getDefaultStore().set(evaluatorsPaginatedStore.actions.refresh)
                onSuccess?.({revisionId: result.newRevisionId, variantId: undefined})
                return {success: true, newRevisionId: result.newRevisionId}
            }

            const selectedMode = mode === "variant" ? "variant" : "version"
            const note = commitMessage

            if (selectedMode === "variant") {
                const variantNameToCreate = editedName?.trim()
                if (!variantNameToCreate) {
                    return {success: false, error: "Variant name is required"}
                }

                const result = await createVariant({
                    baseRevisionId: variantId,
                    baseVariantName: variantName,
                    newVariantName: variantNameToCreate,
                    slug: editedSlug,
                    note,
                    callback: (newRevision, state) => {
                        state.selected = state.selected.map((id) =>
                            id === variantId ? newRevision.id : id,
                        )
                    },
                })

                if (!result.success || !result.newRevisionId) {
                    return {
                        success: false,
                        error: result.error || "Failed to create a new variant",
                        errorStatus: result.errorStatus,
                    }
                }

                if (shouldDeploy && selectedEnvironment) {
                    // Use the new revision's workflow data for references
                    const newRevisionData = workflowMolecule.get.data(result.newRevisionId)
                    await publish({
                        revisionId: result.newRevisionId,
                        environmentSlug: selectedEnvironment,
                        applicationId:
                            newRevisionData?.workflow_id ||
                            runnableData?.workflow_id ||
                            appId ||
                            "",
                        workflowVariantId:
                            newRevisionData?.workflow_variant_id ??
                            runnableData?.workflow_variant_id ??
                            undefined,
                        variantSlug: newRevisionData?.slug ?? runnableData?.slug ?? undefined,
                        revisionVersion: newRevisionData?.version ?? undefined,
                        note,
                    })
                    message.success(`Published ${variantNameToCreate} to ${selectedEnvironment}`)
                }

                clearRegistryVariantNameCache()
                clearEvaluatorWorkflowCache()
                getDefaultStore().set(registryPaginatedStore.actions.refresh)
                getDefaultStore().set(evaluatorsPaginatedStore.actions.refresh)
                onSuccess?.({revisionId: result.newRevisionId, variantId: undefined})
                return {success: true, newRevisionId: result.newRevisionId}
            }

            const result = await commitRevision({
                revisionId: variantId,
                note,
                commitMessage: note,
            })

            if (!result.success || !result.newRevisionId) {
                return {
                    success: false,
                    error: result.error || "Failed to commit revision",
                }
            }

            if (shouldDeploy && selectedEnvironment) {
                const newRevisionData = workflowMolecule.get.data(result.newRevisionId)
                await publish({
                    revisionId: result.newRevisionId,
                    environmentSlug: selectedEnvironment,
                    applicationId:
                        newRevisionData?.workflow_id || runnableData?.workflow_id || appId || "",
                    workflowVariantId:
                        newRevisionData?.workflow_variant_id ??
                        runnableData?.workflow_variant_id ??
                        undefined,
                    variantSlug: newRevisionData?.slug ?? runnableData?.slug ?? undefined,
                    revisionVersion: newRevisionData?.version ?? undefined,
                    note,
                })
                message.success(`Published ${variantName} to ${selectedEnvironment}`)
            }

            clearRegistryVariantNameCache()
            clearEvaluatorWorkflowCache()
            getDefaultStore().set(registryPaginatedStore.actions.refresh)
            getDefaultStore().set(evaluatorsPaginatedStore.actions.refresh)
            onSuccess?.({revisionId: result.newRevisionId, variantId: variantSlug ?? undefined})
            return {success: true, newRevisionId: result.newRevisionId}
        },
        [
            isEphemeral,
            createFromEphemeral,
            createVariant,
            variantId,
            variantName,
            variantSlug,
            shouldDeploy,
            selectedEnvironment,
            publish,
            appId,
            onSuccess,
            commitRevision,
        ],
    )

    const commitModes = useMemo(
        () =>
            isEvaluator
                ? [{id: "version", label: "As a new version"}]
                : [
                      {id: "version", label: "As a new version"},
                      {id: "variant", label: "As a new variant"},
                  ],
        [isEvaluator],
    )

    // For ephemeral entities, render a simplified "Create" modal with editable name.
    // Branch the labels on the entity's type flag — evaluator-create flows show
    // "Evaluator name", app-create flows show "App name", everything else
    // (variant-from-base) keeps the evaluator default for backward compat.
    if (isEphemeral) {
        const createFields = isEvaluator
            ? EVALUATOR_CREATE_FIELDS
            : isApplication
              ? APP_CREATE_FIELDS
              : EVALUATOR_CREATE_FIELDS
        const successMessage = isEvaluator
            ? "Evaluator created successfully"
            : isApplication
              ? "App created successfully"
              : "Created successfully"
        return (
            <EntityCommitModal
                open={open}
                onClose={handleClose}
                entity={{
                    type: "variant",
                    id: variantId,
                    name: variantName,
                }}
                onSubmit={handleSubmit}
                actionLabel="Create"
                createEntityFields={createFields}
                successMessage={successMessage}
            />
        )
    }

    return (
        <EntityCommitModal
            open={open}
            onClose={handleClose}
            entity={{
                type: "variant",
                id: variantId,
                name: variantName,
            }}
            commitModes={commitModes}
            defaultCommitMode="version"
            renderModeContent={({mode}) => (
                <div className="flex flex-col gap-3">
                    {!isEvaluator && (
                        <>
                            <Checkbox
                                checked={shouldDeploy}
                                onChange={(e) => setShouldDeploy(e.target.checked)}
                            >
                                Deploy after commit
                            </Checkbox>

                            {shouldDeploy && (
                                <Select
                                    placeholder="Select environment"
                                    value={selectedEnvironment ?? undefined}
                                    onChange={(value) => setSelectedEnvironment(value)}
                                    options={environmentOptions}
                                />
                            )}
                        </>
                    )}
                </div>
            )}
            canSubmit={({mode, entityName}) => {
                if (mode === "variant") {
                    if (!entityName?.trim()) return false
                }
                if (shouldDeploy && !selectedEnvironment) return false
                return true
            }}
            createEntityFields={VARIANT_CREATE_FIELDS}
            onSubmit={handleSubmit}
            submitLabel="Commit"
        />
    )
}

export default CommitVariantChangesModal
