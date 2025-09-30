import {useCallback} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {currentAppAtom} from "@/oss/state/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {usePlaygroundLayout} from "../../hooks/usePlaygroundLayout"
import {variantListDisplayAtom} from "../../state/atoms"
import NewVariantButton from "../Modals/CreateVariantModal/assets/NewVariantButton"
import type {BaseContainerProps} from "../types"

interface PlaygroundHeaderProps extends BaseContainerProps {
    isLoading?: boolean
}

import {useStyles} from "./styles"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {
    ssr: false,
})

const PlaygroundHeader: React.FC<PlaygroundHeaderProps> = ({
    className,
    isLoading = false,
    ...divProps
}) => {
    const classes = useStyles()

    // ATOM-LEVEL OPTIMIZATION: Use focused atom subscriptions instead of full playground state
    const {displayedVariants} = usePlaygroundLayout()
    const variants = useAtomValue(variantListDisplayAtom) // Only essential display data

    const currentApp = useAtomValue(currentAppAtom)

    // Simplified refresh function - atoms will handle the data updates automatically
    const handleUpdate = useCallback(async () => {
        // For now, use a simple page reload since atoms auto-refresh on mount
        // This is much simpler than complex state mutations
        window.location.reload()
    }, [])

    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: handleUpdate,
        configureWorkflow: true,
    })

    const onAddVariant = useCallback((value: any) => {
        // Handle different data structures that TreeSelect might pass
        let variantIds: string[] = []

        if (Array.isArray(value)) {
            // Multiple selection mode - array of values
            variantIds = value
                .map((item: any) => (typeof item === "string" ? item : item?.value || item))
                .filter(Boolean) // Remove any undefined/null values
        } else if (value !== undefined && value !== null) {
            // Single selection mode - single value
            const singleId = typeof value === "string" ? value : value?.value || value
            if (singleId) {
                variantIds = [singleId]
            }
        }

        if (variantIds.length > 0) {
            void writePlaygroundSelectionToQuery(variantIds)
            return
        }

        void writePlaygroundSelectionToQuery([])
        console.warn("🚨 [PlaygroundHeader] No valid variant IDs found in selection:", value)
    }, [])

    // PROGRESSIVE LOADING: Show skeleton when loading, otherwise show full header
    if (isLoading || !variants) {
        return (
            <div
                className={clsx(
                    "flex items-center justify-between gap-4 px-2.5 py-2",
                    classes.header,
                    className,
                )}
                {...divProps}
            >
                <div className="flex items-center gap-2">
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        Playground
                    </Typography>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-[120px] h-[24px] bg-gray-200 rounded animate-pulse" />
                    <div className="w-[80px] h-[24px] bg-gray-200 rounded animate-pulse" />
                </div>
            </div>
        )
    }

    return (
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
        </>
    )
}

export default PlaygroundHeader
