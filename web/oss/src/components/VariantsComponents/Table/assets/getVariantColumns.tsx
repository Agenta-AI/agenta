import {MoreOutlined} from "@ant-design/icons"
import {CloudArrowUp, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Dropdown, Button} from "antd"
import {ColumnsType} from "antd/es/table"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {filterVariantParameters, isDemo} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

export const getColumns = ({
    handleOpenDetails,
    handleOpenInPlayground,
    handleDeploy,
    handleDeleteVariant,
    showEnvBadges,
    showActionsDropdown,
}: {
    showEnvBadges: boolean
    handleOpenDetails?: (record: EnhancedVariant) => void
    handleOpenInPlayground?: (record: EnhancedVariant) => void
    handleDeploy?: (record: EnhancedVariant) => void
    handleDeleteVariant?: (record: EnhancedVariant) => void
    showActionsDropdown: boolean
}): ColumnsType<EnhancedVariant> => {
    const columns: ColumnsType<EnhancedVariant> = [
        {
            title: "Name",
            dataIndex: "variant_name",
            key: "variant_name",
            fixed: "left",
            width: 280,
            onHeaderCell: () => ({
                style: {minWidth: 280},
            }),
            render: (_, record) => {
                return (
                    <VariantDetailsWithStatus
                        variantName={record.variantName || record.name}
                        revision={record.revision}
                        variant={record}
                        showBadges={showEnvBadges}
                    />
                )
            },
        },
        {
            title: "Model",
            dataIndex: "parameters",
            key: "model",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                const parameters =
                    (
                        (record.parameters?.ag_config as unknown as Record<string, unknown>)
                            ?.prompt as Record<string, unknown>
                    )?.llm_config || record.parameters
                return parameters && Object.keys(parameters).length
                    ? Object.values(
                          filterVariantParameters({record: parameters, key: "model"}),
                      ).map((value, index) => (value ? <div key={index}>{value}</div> : "-"))
                    : "-"
            },
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 120,
            onHeaderCell: () => ({
                style: {minWidth: 120},
            }),
            render: (_, record) => {
                return <div>{record.createdAt}</div>
            },
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "Created by",
            dataIndex: "modifiedBy",
            key: "modifiedBy",
            width: 160,
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                if (record._parentVariant) {
                    return <div>{record.modifiedBy}</div>
                } else {
                    return <div>{record.createdBy}</div>
                }
            },
        })
    }

    columns.push({
        title: "Commit notes",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 560,
        onHeaderCell: () => ({
            style: {minWidth: 560},
        }),
        render: (_, record) => {
            return record.commitMessage ? (
                <div onClick={(e) => e.stopPropagation()}>
                    <TruncatedTooltipTag children={record.commitMessage} width={560} />
                </div>
            ) : null
        },
    })

    if (showActionsDropdown) {
        columns.push({
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleOpenDetails?.(record)
                                    },
                                },
                                {
                                    key: "open_variant",
                                    label: "Open in playground",
                                    icon: <Rocket size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleOpenInPlayground?.(record)
                                    },
                                },
                                {
                                    key: "deploy",
                                    label: "Deploy",
                                    icon: <CloudArrowUp size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleDeploy?.(record)
                                    },
                                },
                                // {
                                //     key: "clone",
                                //     label: "Clone",
                                //     icon: <Copy size={16} />,
                                //     onClick: (e) => {
                                //         e.domEvent.stopPropagation()
                                //     },
                                // },
                                {type: "divider"},
                                // {
                                //     key: "rename",
                                //     label: "Rename",
                                //     icon: <PencilLine size={16} />,
                                //     onClick: (e) => {
                                //         e.domEvent.stopPropagation()

                                //     },
                                // },
                                {
                                    key: "delete_variant",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleDeleteVariant?.(record)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            icon={<MoreOutlined />}
                        />
                    </Dropdown>
                )
            },
        })
    }

    return columns
}
