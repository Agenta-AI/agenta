import {memo, useCallback} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {formatEntityDateTime} from "@agenta/entities/shared"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import {GearSix} from "@phosphor-icons/react"
import {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import UserAvatarTag from "@/oss/components/CustomUIs/UserAvatarTag"
import {
    openDeleteVariantModalAtom,
    type OpenDeleteVariantModalPayload,
} from "@/oss/components/Playground/Components/Modals/DeleteVariantModal/store/deleteVariantModalStore"
import {openDeployVariantModalAtom} from "@/oss/components/Playground/Components/Modals/DeployVariantModal/store/deployVariantModalStore"
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {isDemo} from "@/oss/lib/helpers/utils"
import {EnhancedVariant} from "@/oss/lib/shared/variant/types"

const VariantDropdown = dynamic(() => import("../../Dropdown/VariantDropdown"), {ssr: false})

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const toUnixMs = (value: unknown): number | undefined => {
    if (typeof value !== "string" || !value) return undefined
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : undefined
}

const pickModelFromParams = (value: unknown, depth = 0, visited = new Set<unknown>()): string => {
    if (!value || depth > 6) return ""
    if (visited.has(value)) return ""
    if (typeof value === "object") visited.add(value)

    if (typeof value === "string") {
        return value.trim()
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const result = pickModelFromParams(item, depth + 1, visited)
            if (result) return result
        }
        return ""
    }

    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        const directModel = [obj.model, obj.model_name, obj.modelName, obj.engine].find(
            (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
        ) as string | undefined
        if (directModel) return directModel.trim()

        const llmConfig = obj.llm_config ?? obj.llmConfig
        if (llmConfig) {
            const result = pickModelFromParams(llmConfig, depth + 1, visited)
            if (result) return result
        }

        for (const nested of Object.values(obj)) {
            const result = pickModelFromParams(nested, depth + 1, visited)
            if (result) return result
        }
    }

    return ""
}

const CreatedByCell = memo(({record}: {record: EnhancedVariant}) => {
    const revisionData = useAtomValue(legacyAppRevisionMolecule.atoms.data(record.id)) as any
    const authorIdCandidate =
        [
            (record as any)?.modifiedById,
            (record as any)?.createdById,
            revisionData?.modifiedById,
            revisionData?.createdById,
            (record as any)?.author,
            revisionData?.author,
            (record as any)?.modifiedBy,
            revisionData?.modifiedBy,
        ].find((value) => typeof value === "string" && UUID_REGEX.test(value.trim())) ?? undefined
    const resolvedAuthorName = useUserDisplayName(authorIdCandidate)
    const fallbackName =
        [
            resolvedAuthorName,
            (record as any)?.modifiedByDisplayName,
            (record as any)?.modifiedBy,
            (record as any)?.author,
            (record as any)?.modifiedById,
            (record as any)?.createdByDisplayName,
            (record as any)?.createdBy,
            (record as any)?.createdById,
            revisionData?.modifiedByDisplayName,
            revisionData?.modifiedBy,
            revisionData?.author,
            revisionData?.createdByDisplayName,
            revisionData?.createdBy,
            revisionData?.createdById,
        ].find((value) => typeof value === "string" && value.trim().length > 0) ?? undefined

    return <UserAvatarTag nameOverride={fallbackName} modifiedBy={fallbackName} />
})

const CreatedOnCell = memo(({record}: {record: EnhancedVariant}) => {
    const revisionData = useAtomValue(legacyAppRevisionMolecule.atoms.data(record.id)) as any
    const ts =
        (record as any).createdAtTimestamp ??
        toUnixMs(revisionData?.createdAt) ??
        (record as any).updatedAtTimestamp
    const formatted = ts ? formatEntityDateTime(ts) : ""
    return <div>{formatted}</div>
})

const UpdatedOnCell = memo(({record}: {record: EnhancedVariant}) => {
    const revisionData = useAtomValue(legacyAppRevisionMolecule.atoms.data(record.id)) as any
    const ts =
        (record as any).updatedAtTimestamp ??
        toUnixMs(revisionData?.updatedAt) ??
        toUnixMs(revisionData?.createdAt) ??
        (record as any).createdAtTimestamp
    const formatted = ts ? formatEntityDateTime(ts) : ""
    return <div>{formatted}</div>
})

const ModelCell = memo(({record}: {record: EnhancedVariant}) => {
    const revisionData = useAtomValue(legacyAppRevisionMolecule.atoms.data(record.id)) as any
    const params = revisionData?.parameters ?? (record.parameters as any)
    const name = pickModelFromParams(params)

    return <div>{name || "-"}</div>
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
            (r: EnhancedVariant): OpenDeleteVariantModalPayload => {
                const selection = Array.from(new Set((selectedRowKeys || []).map(String)))
                const recordKey = String((r as any)._revisionId ?? (r as any)._id ?? (r as any).id)
                const recordSelected = selection.includes(recordKey)
                const isGroupedParentRow = Boolean((r as any)._isParentRow)
                const variantId = String((r as any).variantId ?? "")

                if (recordSelected && selection.length > 0) {
                    return {
                        revisionIds: selection,
                        forceVariantIds: isGroupedParentRow && variantId ? [variantId] : [],
                    }
                }

                const childKeys = ((r as any).children || [])
                    .map((child: any) => String(child?._revisionId ?? child?.id))
                    .filter((id: string | null | undefined) => Boolean(id))

                if (childKeys.length > 0) {
                    return {
                        revisionIds: Array.from(new Set([recordKey, ...childKeys])),
                        forceVariantIds: variantId ? [variantId] : [],
                    }
                }

                return {
                    revisionIds: [recordKey],
                    forceVariantIds: isGroupedParentRow && variantId ? [variantId] : [],
                }
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
    showUpdatedOn = false,
    selectedRowKeys,
}: {
    showEnvBadges: boolean
    handleOpenDetails?: (record: EnhancedVariant) => void
    handleOpenInPlayground?: (record: EnhancedVariant) => void
    showActionsDropdown: boolean
    showStableName?: boolean
    showUpdatedOn?: boolean
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

    if (showUpdatedOn) {
        columns.push({
            title: "Updated on",
            dataIndex: "updatedAt",
            key: "updatedAt",
            onHeaderCell: () => ({
                style: {minWidth: 120},
            }),
            render: (_, record) => <UpdatedOnCell record={record} />,
        })
    }

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
