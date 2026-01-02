import {useMemo} from "react"

import {GearSix, Note, Copy, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
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
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 180}}
                            menu={{
                                items: [
                                    {
                                        key: "details",
                                        label: "View details",
                                        icon: <Note size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            onViewDetails(record)
                                        },
                                    },
                                    {
                                        key: "clone",
                                        label: "Clone",
                                        icon: <Copy size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            onClone(record)
                                        },
                                    },
                                    {
                                        key: "copy-id",
                                        label: "Copy ID",
                                        icon: <Copy size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            copyToClipboard(record._id)
                                        },
                                    },
                                    {type: "divider"},
                                    {
                                        key: "rename",
                                        label: "Rename",
                                        icon: <PencilSimple size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            onRename(record)
                                        },
                                    },
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        danger: true,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            onDelete(record)
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button
                                onClick={(e) => e.stopPropagation()}
                                type="text"
                                icon={<GearSix size={16} />}
                                size="small"
                            />
                        </Dropdown>
                    )
                },
            },
        ],
        [onViewDetails, onClone, onRename, onDelete],
    )
}
