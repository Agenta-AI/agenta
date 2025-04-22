import dynamic from "next/dynamic"
import {ColumnsType} from "antd/es/table"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {filterVariantParameters, isDemo} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {GearSix} from "@phosphor-icons/react"
import {Tag} from "antd"
import Avatar from "@/oss/components/Avatar/Avatar"

const VariantDropdown = dynamic(() => import("../../Dropdown/VariantDropdown"), {ssr: false})

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
                    return (
                        <Tag bordered={false}>
                            <Avatar name={record?.modifiedBy} className="w-4 h-4 text-[9px]" />{" "}
                            {record?.modifiedBy}
                        </Tag>
                    )
                } else {
                    return (
                        <Tag bordered={false}>
                            <Avatar name={record?.createdBy} className="w-4 h-4 text-[9px]" />{" "}
                            {record?.createdBy}
                        </Tag>
                    )
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
                    <VariantDropdown
                        record={record}
                        handleOpenDetails={handleOpenDetails}
                        handleOpenInPlayground={handleOpenInPlayground}
                        handleDeploy={handleDeploy}
                        handleDeleteVariant={handleDeleteVariant}
                    />
                )
            },
        })
    }

    return columns
}
