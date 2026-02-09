import {memo, useCallback} from "react"

import {GearSix} from "@phosphor-icons/react"
import {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import UserAvatarTag from "@/oss/components/CustomUIs/UserAvatarTag"
import {openDeleteVariantModalAtom} from "@/oss/components/Playground/Components/Modals/DeleteVariantModal/store/deleteVariantModalStore"
import {openDeployVariantModalAtom} from "@/oss/components/Playground/Components/Modals/DeployVariantModal/store/deployVariantModalStore"
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {isDemo} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

const VariantDropdown = dynamic(() => import("../../Dropdown/VariantDropdown"), {ssr: false})

const CreatedByCell = memo(({record}: {record: EnhancedVariant}) => {
    const fallbackName =
        [
            (record as any)?.modifiedByDisplayName,
            (record as any)?.modifiedBy,
            (record as any)?.modifiedById,
            (record as any)?.createdByDisplayName,
            (record as any)?.createdBy,
            (record as any)?.createdById,
        ].find((value) => typeof value === "string" && value.trim().length > 0) ?? undefined

    return (
        <UserAvatarTag
            variantId={record.id}
            nameOverride={fallbackName}
            modifiedBy={fallbackName}
        />
    )
})

const CreatedOnCell = memo(({record}: {record: EnhancedVariant}) => {
    return <div>{record.createdAt}</div>
})

const ModelCell = memo(({record}: {record: EnhancedVariant}) => {
    const inlineConfig = (record.parameters as any)?.prompt?.llm_config || record.parameters || {}
    const name =
        (record.modelName as string | undefined) ||
        (inlineConfig && typeof inlineConfig === "object"
            ? (inlineConfig as any)?.model
            : undefined)

    return <div>{(typeof name === "string" && name.trim()) || "-"}</div>
})

const CommitNotesCell = memo(({record}: {record: EnhancedVariant}) => {
    const msg = record.commitMessage
    return msg ? (
        <div onClick={(e) => e.stopPropagation()}>
            <TruncatedTooltipTag children={msg} width={560} />
        </div>
    ) : null
})

const ActionCell = memo(
    ({
        record,
        handleOpenDetails,
        handleOpenInPlayground,
        selectedRowKeys,
    }: {
        record: EnhancedVariant
        handleOpenDetails?: (record: EnhancedVariant) => void
        handleOpenInPlayground?: (record: EnhancedVariant) => void
        selectedRowKeys?: (string | number)[]
    }) => {
        const openDeleteVariantModal = useSetAtom(openDeleteVariantModalAtom)
        const openDeployVariantModal = useSetAtom(openDeployVariantModalAtom)

        const resolveDeletionTargets = useCallback(
            (r: EnhancedVariant) => {
                const selection = Array.from(new Set((selectedRowKeys || []).map(String)))
                const recordKey = String((r as any)._revisionId ?? (r as any)._id ?? (r as any).id)
                const recordSelected = selection.includes(recordKey)

                if (recordSelected && selection.length > 0) {
                    return selection
                }

                const childKeys = ((r as any).children || [])
                    .map((child: any) => String(child?._revisionId ?? child?.id))
                    .filter((id: string | null | undefined) => Boolean(id))

                if (childKeys.length > 0) {
                    return Array.from(new Set([recordKey, ...childKeys]))
                }

                return [recordKey]
            },
            [selectedRowKeys],
        )

        const onDeploy = useCallback(
            (r: EnhancedVariant) => {
                // In this overview table, each row represents a revision. Always pass revisionId.
                const payload = {
                    parentVariantId: null,
                    revisionId: (r as any)._revisionId ?? (r as any)._id ?? (r as any).id,
                    variantName: (r as any).variantName,
                    revision: (r as any).revision ?? (r as any).revisionNumber,
                }
                console.debug("[VariantsTable] deploy:open", {record: r, payload})
                openDeployVariantModal(payload)
            },
            [openDeployVariantModal],
        )

        const onDelete = useCallback(
            (r: EnhancedVariant) => {
                // Open the global DeleteVariant modal immediately; it will perform its own pre-check
                openDeleteVariantModal(resolveDeletionTargets(r))
            },
            [openDeleteVariantModal, resolveDeletionTargets],
        )

        return (
            <VariantDropdown
                record={record}
                handleOpenDetails={handleOpenDetails}
                handleOpenInPlayground={handleOpenInPlayground}
                handleDeploy={onDeploy}
                handleDeleteVariant={onDelete}
            />
        )
    },
)

export const getColumns = ({
    handleOpenDetails,
    handleOpenInPlayground,
    showEnvBadges,
    showActionsDropdown,
    showStableName = false,
    selectedRowKeys,
}: {
    showEnvBadges: boolean
    handleOpenDetails?: (record: EnhancedVariant) => void
    handleOpenInPlayground?: (record: EnhancedVariant) => void
    showActionsDropdown: boolean
    showStableName?: boolean
    selectedRowKeys?: (string | number)[]
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
            render: (_, record) => (
                <VariantNameCell
                    revisionId={record.id}
                    revision={record}
                    revisionName={record.variantName ?? record.name ?? null}
                    showBadges={showEnvBadges}
                    // Avoid showing draft tag for selection tables when requested
                    // (uses stable name display)
                    showStable={showStableName}
                />
            ),
        },
        {
            title: "Model",
            dataIndex: "parameters",
            key: "model",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => <ModelCell record={record} />,
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            onHeaderCell: () => ({
                style: {minWidth: 120},
            }),
            render: (_, record) => <CreatedOnCell record={record} />,
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "Created by",
            dataIndex: "modifiedBy",
            key: "modifiedBy",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <CreatedByCell record={record} />
            },
        })
    }

    columns.push({
        title: "Commit notes",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 180,
        onHeaderCell: () => ({
            style: {minWidth: 180, maxWidth: 560},
        }),
        className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[560px]",
        render: (_, record) => <CommitNotesCell record={record} />,
    })

    if (showActionsDropdown) {
        columns.push({
            title: <GearSix size={16} />,
            key: "key",
            width: 61,
            fixed: "right",
            align: "center",
            render: (_, record) => (
                <ActionCell
                    record={record}
                    handleOpenDetails={handleOpenDetails}
                    handleOpenInPlayground={handleOpenInPlayground}
                    selectedRowKeys={selectedRowKeys}
                />
            ),
        })
    }

    return columns
}
