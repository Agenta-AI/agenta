import {useCallback} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {useAppsData} from "@/oss/contexts/app.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {fetchAndProcessRevisions} from "@/oss/lib/shared/variant"
import {detectChatVariantFromOpenAISchema} from "@/oss/lib/shared/variant/genericTransformer"

import usePlayground from "../../hooks/usePlayground"
import {
    initializeGenerationInputs,
    initializeGenerationMessages,
} from "../../hooks/usePlayground/assets/generationHelpers"
import {updateStateWithProcessedRevisions} from "../../hooks/usePlayground/assets/stateHelpers"
import NewVariantButton from "../Modals/CreateVariantModal/assets/NewVariantButton"
import type {BaseContainerProps} from "../types"

import {useStyles} from "./styles"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {
    ssr: false,
})

const PlaygroundHeader: React.FC<BaseContainerProps> = ({className, ...divProps}) => {
    const classes = useStyles()
    const {toggleVariantDisplay, displayedVariants, variants, mutate} = usePlayground()
    const {currentApp} = useAppsData()

    const handleUpdate = useCallback(async () => {
        return await mutate(async (clonedState) => {
            if (!currentApp?.app_id) {
                return clonedState
            }

            try {
                // Use the fetchAndProcessRevisions utility with forceRefresh parameter
                // This ensures we get fresh data instead of relying on cached values
                const {
                    revisions: processedRevisions,
                    spec,
                    uri,
                } = await fetchAndProcessRevisions({
                    appId: currentApp.app_id,
                    projectId: getCurrentProject().projectId,
                    forceRefresh: true, // Force refresh the schema and variants
                    logger: console.log,
                    keyParts: "playground",
                    appType: clonedState.appType,
                })

                // Update state with processed revisions using our shared utility
                clonedState = updateStateWithProcessedRevisions(
                    clonedState,
                    processedRevisions,
                    spec,
                    uri,
                )

                // After updating the state with all revisions, select the first one for display
                if (processedRevisions.length > 0) {
                    clonedState.selected = [processedRevisions[0].id]
                }

                // Initialize generation data for the selected variants
                clonedState.generationData.inputs = initializeGenerationInputs(
                    clonedState.variants.filter((v) => clonedState.selected.includes(v.id)),
                    spec,
                    uri.routePath,
                )

                // Initialize chat messages if needed
                if (detectChatVariantFromOpenAISchema(spec, uri)) {
                    clonedState.generationData.messages = initializeGenerationMessages(
                        clonedState.variants,
                    )
                }

                // Clear any previous errors
                clonedState.error = undefined

                return clonedState
            } catch (error) {
                console.error("Error updating app schema:", error)
                clonedState.error = error instanceof Error ? error : new Error(String(error))
                return clonedState
            }
            //     spec,
            //     undefined,
            //     clonedState.routePath,
            // )

            // atomStore.set(specAtom, () => spec)

            // clonedState.selected = [clonedState.variants[0].id]

            // clonedState.generationData.inputs = initializeGenerationInputs(
            //     clonedState.variants.filter((v) => clonedState.selected.includes(v.id)),
            //     spec,
            //     clonedState.uri.routePath,
            // )

            // if (detectChatVariantFromOpenAISchema(spec, clonedState.uri)) {
            //     clonedState.generationData.messages = initializeGenerationMessages(
            //         clonedState.variants,
            //     )
            // }

            // clonedState.error = undefined
            // clonedState.forceRevalidate = false
            return clonedState
        })
    }, [])

    const {CustomWorkflowModal, openModal} = useCustomWorkflowConfig({
        afterConfigSave: handleUpdate,
    })

    const onAddVariant = useCallback(
        (value: any) => {
            const variantIds = value.map((item: any) =>
                typeof item === "string" ? item : item.value,
            )

            const newSelection = variantIds.find((id: string) => !displayedVariants?.includes(id))
            const removedSelection = displayedVariants?.find((id) => !variantIds.includes(id))

            if (newSelection) {
                toggleVariantDisplay?.(newSelection, true)
            } else if (removedSelection && displayedVariants && displayedVariants.length > 1) {
                toggleVariantDisplay?.(removedSelection, false)
            }
        },
        [toggleVariantDisplay, displayedVariants],
    )

    // Only render if variants are available
    return variants ? (
        <>
            <div
                className={clsx(
                    "flex items-center justify-between gap-4 px-2.5 py-2",
                    classes.header,
                    className,
                )}
                {...divProps}
            >
                <div className="flex items-center gap-2">
                    {currentApp?.app_type === "custom" ? (
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 180}}
                            menu={{
                                items: [
                                    ...[
                                        {
                                            key: "configure",
                                            label: "Configure workflow",
                                            icon: <PencilSimple size={16} />,
                                            onClick: openModal,
                                        },
                                    ],
                                ],
                            }}
                        >
                            <Button type="text" icon={<MoreOutlined />} />
                        </Dropdown>
                    ) : null}
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        Playground
                    </Typography>
                </div>

                <div className="flex items-center gap-2">
                    <SelectVariant
                        showAsCompare
                        multiple
                        onChange={(value) => onAddVariant(value)}
                        value={displayedVariants}
                    />
                    <NewVariantButton label="Variant" size="small" />
                </div>
            </div>

            {CustomWorkflowModal}
        </>
    ) : null
}

export default PlaygroundHeader
