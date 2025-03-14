import {useCallback, useEffect, useMemo, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import CustomWorkflowModal from "@/oss/components/pages/app-management/modals/CustomWorkflowModal"
import {useAppsData} from "@/oss/contexts/app.context"
import axios from "@/oss/lib/api/assets/axiosConfig"

import {detectChatVariantFromOpenAISchema} from "../../assets/utilities/genericTransformer"
import {OpenAPISpec} from "../../assets/utilities/genericTransformer/types"
import {EnhancedVariant} from "../../assets/utilities/transformer/types"
import usePlayground from "../../hooks/usePlayground"
import {
    initializeGenerationInputs,
    initializeGenerationMessages,
} from "../../hooks/usePlayground/assets/generationHelpers"
import {
    fetchOpenApiSchemaJson,
    findCustomWorkflowPath,
    setVariants,
    transformVariants,
} from "../../hooks/usePlayground/assets/helpers"
import {atomStore, specAtom} from "../../state"
import type {BaseContainerProps} from "../types"

import {useStyles} from "./styles"
const PlaygroundCreateNewVariant = dynamic(() => import("../Menus/PlaygroundCreateNewVariant"), {
    ssr: false,
})

const PlaygroundHeader: React.FC<BaseContainerProps> = ({className, ...divProps}) => {
    const classes = useStyles()
    const {toggleVariantDisplay, displayedVariants, variants, mutate} = usePlayground()
    const {currentApp} = useAppsData()
    const [isCustomWorkflowModalOpen, setIsCustomWorkflowModalOpen] = useState(false)
    const singleVariant: EnhancedVariant | undefined = useMemo(() => variants?.[0], [variants])

    const [customWorkflowAppValues, setCustomWorkflowAppValues] = useState(() => ({
        appName: "",
        appUrl: "",
        appDesc: "",
    }))

    const handleUpdate = useCallback(async () => {
        return await mutate(async (clonedState) => {
            const {data: variants} = await axios.get(`/api/apps/${currentApp?.app_id}/variants`)

            const specPath = await findCustomWorkflowPath(variants[0].uri)

            clonedState.uri = specPath

            if (
                clonedState.uri?.routePath === undefined ||
                clonedState.uri?.runtimePrefix === undefined
            ) {
                return clonedState
            }

            const specResponse = await fetchOpenApiSchemaJson(clonedState.uri.runtimePrefix)
            const spec = clonedState.spec || (specResponse.schema as OpenAPISpec)

            if (!spec) {
                throw new Error("No spec found")
            }

            clonedState.variants = transformVariants(
                setVariants(clonedState.variants, variants),
                spec,
                undefined,
                clonedState.routePath,
            )

            atomStore.set(specAtom, () => spec)

            clonedState.selected = [clonedState.variants[0].id]

            clonedState.generationData.inputs = initializeGenerationInputs(
                clonedState.variants.filter((v) => clonedState.selected.includes(v.id)),
                spec,
                clonedState.uri.routePath,
            )

            if (detectChatVariantFromOpenAISchema(spec, clonedState.uri)) {
                clonedState.generationData.messages = initializeGenerationMessages(
                    clonedState.variants,
                )
            }

            clonedState.error = undefined
            clonedState.forceRevalidate = false
            return clonedState
        })
    }, [])

    useEffect(() => {
        if (singleVariant) {
            setCustomWorkflowAppValues({
                appName: currentApp?.app_name ?? "",
                appUrl: singleVariant?.uri ?? "",
                appDesc: "",
            })
        }
    }, [singleVariant, currentApp])
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
                                            onClick: () => setIsCustomWorkflowModalOpen(true),
                                        },
                                        //   {
                                        //       key: "history",
                                        //       label: "History",
                                        //       icon: <ClockCounterClockwise size={16} />,
                                        //       onClick: () =>
                                        //           setIsCustomWorkflowHistoryDrawerOpen(true),
                                        //   },
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

                <PlaygroundCreateNewVariant
                    displayedVariants={displayedVariants}
                    onSelect={toggleVariantDisplay}
                    buttonProps={{label: "Compare"}}
                />
            </div>

            <CustomWorkflowModal
                open={isCustomWorkflowModalOpen}
                onCancel={() => setIsCustomWorkflowModalOpen(false)}
                customWorkflowAppValues={customWorkflowAppValues}
                setCustomWorkflowAppValues={setCustomWorkflowAppValues}
                handleCreateApp={() => {}}
                configureWorkflow
                mutate={handleUpdate}
                variants={variants}
            />
        </>
    ) : null
}

export default PlaygroundHeader
