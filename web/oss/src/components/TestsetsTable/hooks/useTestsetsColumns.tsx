import {useMemo} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {ArchiveIcon, GearSix, Note, Copy, PencilSimple} from "@phosphor-icons/react"
import type {ColumnsType} from "antd/es/table"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {formatDate} from "@/oss/lib/helpers/dateTimeHelper"

import type {TestsetTableRow} from "../atoms/tableStore"
import LatestCommitMessage from "../components/LatestCommitMessage"

export interface UseTestsetsColumnsParams {
    onViewDetails: (record: TestsetTableRow) => void
    onClone: (record: TestsetTableRow) => void
    onRename: (record: TestsetTableRow) => void
    onDelete: (record: TestsetTableRow) => void
}

export const useTestsetsColumns = ({
    onViewDetails,
    onClone,
    onRename,
    onDelete,
}: UseTestsetsColumnsParams): ColumnsType<TestsetTableRow> => {
    return useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                width: 300,
                columnVisibilityLocked: true,
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
            },
            {
                title: "Commit Message",
                key: "commit_message",
                width: 200,
                onHeaderCell: () => ({
                    style: {minWidth: 150},
                }),
                render: (_, record) => {
                    if (record.__isSkeleton) return null
                    return <LatestCommitMessage testsetId={record.id} />
                },
            },
            {
                title: "Date Modified",
                dataIndex: "updated_at",
                key: "updated_at",
                width: 220,
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
                render: (date: string) => {
                    return formatDate(date)
                },
            },
            {
                title: "Date created",
                dataIndex: "created_at",
                key: "created_at",
                width: 220,
                render: (date: string) => {
                    return formatDate(date)
                },
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 56,
                fixed: "right",
                align: "center",
                columnVisibilityLocked: true,
                render: (_, record) => {
                    if (record.__isSkeleton) return null

                    return (
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GearSix size={16} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" style={{width: 180}}>
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onViewDetails(record)
                                    }}
                                >
                                    <Note size={16} />
                                    View details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onClone(record)
                                    }}
                                >
                                    <Copy size={16} />
                                    Clone
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        copyToClipboard(record._id)
                                    }}
                                >
                                    <Copy size={16} />
                                    Copy ID
                                </DropdownMenuItem>
                                {record.slug && (
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            copyToClipboard(record.slug!)
                                        }}
                                    >
                                        <Copy size={16} />
                                        Copy Slug
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onRename(record)
                                    }}
                                >
                                    <PencilSimple size={16} />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onDelete(record)
                                    }}
                                >
                                    <ArchiveIcon size={14} />
                                    Archive
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )
                },
            },
        ],
        [onViewDetails, onClone, onRename, onDelete],
    )
}
