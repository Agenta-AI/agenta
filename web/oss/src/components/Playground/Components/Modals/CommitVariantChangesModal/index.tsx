import {useCallback, useMemo, useState} from "react"

import {publishMutationAtom} from "@agenta/entities/runnable"
import {workflowMolecule, createWorkflowFromEphemeralAtom} from "@agenta/entities/workflow"
import {EntityCommitModal} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {Checkbox, Input, Select, Typography} from "antd"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"

import EnvironmentTagLabel, {deploymentStatusColors} from "@/oss/components/EnvironmentTagLabel"
import {
    evaluatorsPaginatedStore,
    clearEvaluatorWorkflowCache,
} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {
    registryPaginatedStore,
    clearRegistryVariantNameCache,
} from "@/oss/components/VariantsComponents/store/registryStore"
import {isVariantNameInputValid} from "@/oss/lib/helpers/utils"
import {selectedAppIdAtom} from "@/oss/state/app"

import {CommitVariantChangesModalProps} from "./assets/types"

const {Text} = Typography

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    onSuccess,
    ...props
}) => {
    const {onCancel, open} = props

    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isEphemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(variantId || ""))

    const appId = useAtomValue(selectedAppIdAtom)
    const commitRevision = useSetAtom(playgroundController.actions.commitRevision)
    const createVariant = useSetAtom(playgroundController.actions.createVariant)
    const createFromEphemeral = useSetAtom(createWorkflowFromEphemeralAtom)
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)

    const [newVariantName, setNewVariantName] = useState("")
    const [shouldDeploy, setShouldDeploy] = useState(false)
    const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null)

    const variantName = runnableData?.name || "Variant"
    const variantSlug = runnableData?.slug

    const environmentOptions = useMemo(
        () =>
            (Object.keys(deploymentStatusColors) as (keyof typeof deploymentStatusColors)[]).map(
                (env) => ({
                    value: env,
                    label: <EnvironmentTagLabel environment={env} />,
                }),
            ),
        [],
    )

    const handleClose = useCallback(() => {
        onCancel?.({} as never)
        setNewVariantName("")
        setShouldDeploy(false)
        setSelectedEnvironment(null)
    }, [onCancel])

    const handleSubmit = useCallback(
        async ({
            message: commitMessage,
            mode,
            entityName: editedName,
        }: {
            message: string
            mode?: string
            entityName?: string
        }) => {
            // Ephemeral entities: create a new workflow via the entities package reducer
            if (isEphemeral) {
                const result = await createFromEphemeral({
                    revisionId: variantId,
                    commitMessage,
                    name: editedName,
                })

                if (!result.success) {
                    return {
                        success: false,
                        error:
                            "error" in result ? result.error.message : "Failed to create workflow",
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
                const result = await createVariant({
                    baseRevisionId: variantId,
                    baseVariantName: variantName,
                    newVariantName: newVariantName,
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
                    message.success(`Published ${variantName} to ${selectedEnvironment}`)
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
            newVariantName,
            shouldDeploy,
            selectedEnvironment,
            publish,
            appId,
            onSuccess,
            commitRevision,
        ],
    )

    const commitModes = useMemo(
        () => [
            {id: "version", label: "As a new version"},
            {id: "variant", label: "As a new variant"},
        ],
        [],
    )

    // For ephemeral entities, render a simplified "Create" modal with editable name
    if (isEphemeral) {
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
                entityNameEditable
                successMessage="Evaluator created successfully"
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
            modeLabel={newVariantName || undefined}
            renderModeContent={({mode}) => (
                <div className="flex flex-col gap-3">
                    {mode === "variant" && (
                        <div className="flex flex-col gap-1">
                            <Input
                                placeholder="A unique variant name"
                                value={newVariantName}
                                status={
                                    newVariantName && !isVariantNameInputValid(newVariantName)
                                        ? "error"
                                        : undefined
                                }
                                onChange={(e) => setNewVariantName(e.target.value)}
                            />
                            {newVariantName && !isVariantNameInputValid(newVariantName) && (
                                <Text className="text-xs text-[#EF4444]">
                                    Variant name must contain only letters, numbers, underscore, or
                                    dash
                                </Text>
                            )}
                        </div>
                    )}

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
                </div>
            )}
            canSubmit={({mode}) => {
                if (mode === "variant") {
                    if (!newVariantName || !isVariantNameInputValid(newVariantName)) return false
                }
                if (shouldDeploy && !selectedEnvironment) return false
                return true
            }}
            onSubmit={handleSubmit}
            submitLabel="Commit"
        />
    )
}

export default CommitVariantChangesModal
