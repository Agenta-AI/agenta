import {useCallback, useMemo, useState} from "react"

import {publishMutationAtom, runnableBridge} from "@agenta/entities/runnable"
import {EntityCommitModal} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {Checkbox, Input, Select, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import EnvironmentTagLabel, {deploymentStatusColors} from "@/oss/components/EnvironmentTagLabel"
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

    // Use runnableBridge for entity-type-aware data access
    const runnableData = useAtomValue(runnableBridge.data(variantId || ""))

    const appId = useAtomValue(selectedAppIdAtom)
    const commitRevision = useSetAtom(playgroundController.actions.commitRevision)
    const createVariant = useSetAtom(playgroundController.actions.createVariant)
    const {mutateAsync: publish} = useAtomValue(publishMutationAtom)

    const [newVariantName, setNewVariantName] = useState("")
    const [shouldDeploy, setShouldDeploy] = useState(false)
    const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(null)

    const variantName = runnableData?.name || "Variant"
    const variantSlug = runnableData?.slug
    const configuration = runnableData?.configuration

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
        async ({message: commitMessage, mode}: {message: string; mode?: string}) => {
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
                    await publish({
                        type: "revision",
                        revision_id: result.newRevisionId,
                        environment_ref: selectedEnvironment,
                        application_id: appId || undefined,
                        note,
                    })
                    message.success(
                        `Published ${variantName} to ${selectedEnvironment}`,
                    )
                }

                onSuccess?.({revisionId: result.newRevisionId, variantId: undefined})
                return {success: true, newRevisionId: result.newRevisionId}
            }

            const result = await commitRevision({
                revisionId: variantId,
                note,
                commitMessage: note,
                variantId: variantSlug,
                parameters: configuration ?? {},
            })

            if (!result.success || !result.newRevisionId) {
                return {
                    success: false,
                    error: result.error || "Failed to commit revision",
                }
            }

            if (shouldDeploy && selectedEnvironment) {
                await publish({
                    type: "revision",
                    revision_id: result.newRevisionId,
                    environment_ref: selectedEnvironment,
                    application_id: appId || undefined,
                    note,
                })
                message.success(
                    `Published ${variantName} to ${selectedEnvironment}`,
                )
            }

            onSuccess?.({revisionId: result.newRevisionId, variantId: variantSlug})
            return {success: true, newRevisionId: result.newRevisionId}
        },
        [
            createVariant,
            variantId,
            variantName,
            variantSlug,
            configuration,
            newVariantName,
            shouldDeploy,
            selectedEnvironment,
            publish,
            appId,
            onSuccess,
            commitRevision,
        ],
    )

    const commitModes = [
        {id: "version", label: "As a new version"},
        {id: "variant", label: "As a new variant"},
    ]

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
