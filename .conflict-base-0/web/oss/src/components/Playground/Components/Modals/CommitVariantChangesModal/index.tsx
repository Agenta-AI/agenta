import {useCallback, useMemo} from "react"

import {publishMutationAtom} from "@agenta/entities/runnable"
import {workflowMolecule, createWorkflowFromEphemeralAtom} from "@agenta/entities/workflow"
import {EntityCommitModal} from "@agenta/entity-ui"
import type {
    CommitSubmitParams,
    CommitCreateFieldsConfig,
    CommitDeployOption,
} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {environmentColors} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
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

    const variantName = runnableData?.name || "Variant"
    const variantSlug = runnableData?.slug

    // Environments offered in the footer's "Commit & deploy to …" split-button dropdown.
    const commitDeployOptions = useMemo<CommitDeployOption[]>(
        () => Object.keys(environmentColors).map((env) => ({key: env, label: env})),
        [],
    )

    const handleClose = useCallback(() => {
        onCancel?.({} as never)
    }, [onCancel])

    // Deploy the just-committed revision to each chosen environment. The deploy API is
    // single-env per call (no batch endpoint), so we fan out and report partial failures.
    const deployRevision = useCallback(
        async (
            newRevisionId: string,
            label: string,
            note: string | undefined,
            deployEnvironments: string[] | undefined,
            deployMessage?: string,
        ) => {
            if (!deployEnvironments || deployEnvironments.length === 0) return
            const newRevisionData = workflowMolecule.get.data(newRevisionId)
            const refs = {
                revisionId: newRevisionId,
                applicationId:
                    newRevisionData?.workflow_id || runnableData?.workflow_id || appId || "",
                workflowVariantId:
                    newRevisionData?.workflow_variant_id ??
                    runnableData?.workflow_variant_id ??
                    undefined,
                variantSlug:
                    newRevisionData?.workflow_variant_slug ??
                    newRevisionData?.variant_slug ??
                    runnableData?.workflow_variant_slug ??
                    runnableData?.variant_slug ??
                    undefined,
                revisionVersion: newRevisionData?.version ?? undefined,
                note: deployMessage ?? note,
            }
            // Fan out concurrently — the calls are independent, so N environments cost 1× latency.
            const results = await Promise.allSettled(
                deployEnvironments.map((environmentSlug) => publish({...refs, environmentSlug})),
            )
            const succeeded = deployEnvironments.filter((_, i) => results[i].status === "fulfilled")
            const failed = deployEnvironments.filter((_, i) => results[i].status === "rejected")
            if (succeeded.length) {
                message.success(`Published ${label} to ${succeeded.join(", ")}`)
            }
            if (failed.length) {
                message.error(`Couldn't publish ${label} to ${failed.join(", ")}`)
            }
        },
        [publish, runnableData, appId],
    )

    const handleSubmit = useCallback(
        async ({
            message: commitMessage,
            mode,
            entityName: editedName,
            entitySlug: editedSlug,
            deployEnvironments,
            deployMessage,
        }: CommitSubmitParams) => {
            // Ephemeral entities: create a new workflow via the entities package reducer
            if (isEphemeral) {
                const result = await createFromEphemeral({
                    revisionId: variantId,
                    commitMessage: commitMessage ?? undefined,
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
            const note = commitMessage ?? undefined

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

                await deployRevision(
                    result.newRevisionId,
                    variantNameToCreate,
                    note,
                    deployEnvironments,
                    deployMessage,
                )

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

            await deployRevision(
                result.newRevisionId,
                variantName,
                note,
                deployEnvironments,
                deployMessage,
            )

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
            deployRevision,
            onSuccess,
            commitRevision,
        ],
    )

    const commitModes = useMemo(
        () =>
            isEvaluator
                ? [{id: "version", label: "As a new version"}]
                : [
                      {id: "version", label: `Update ${variantName}`},
                      {id: "variant", label: "Save as a new variant"},
                  ],
        [isEvaluator, variantName],
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
        // The drawer wrapper (`useDrawerCreateCommitCallback`) toasts
        // "App created successfully" / "Evaluator created successfully"
        // on its `onNewRevision` hook. Letting the modal also toast
        // would surface two identical notifications. For unrecognized
        // ephemeral flows (no evaluator / no application flag) we keep
        // the modal toast as a fallback.
        const successMessage = isEvaluator || isApplication ? null : "Created successfully"
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
            commitDeployOptions={isEvaluator ? undefined : commitDeployOptions}
            canSubmit={({mode, entityName}) => {
                if (mode === "variant") {
                    if (!entityName?.trim()) return false
                }
                return true
            }}
            createEntityFields={VARIANT_CREATE_FIELDS}
            onSubmit={handleSubmit}
            submitLabel="Commit"
        />
    )
}

export default CommitVariantChangesModal
