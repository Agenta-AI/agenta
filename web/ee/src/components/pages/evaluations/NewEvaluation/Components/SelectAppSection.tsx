import {HTMLProps, ReactNode, useMemo} from "react"

import {Table, Tag, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import type {NewEvaluationAppOption} from "../types"

const formatAppType = (type?: string | null) => {
    if (!type) return null
    const normalized = type.replace(/_/g, " ")
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

interface SelectAppSectionProps extends HTMLProps<HTMLDivElement> {
    apps: NewEvaluationAppOption[]
    selectedAppId: string
    onSelectApp: (value: string) => void
    disabled?: boolean
    emptyText?: ReactNode
}

const SelectAppSection = ({
    apps,
    selectedAppId,
    onSelectApp,
    disabled,
    className,
    emptyText,
}: SelectAppSectionProps) => {
    const columns: ColumnsType<NewEvaluationAppOption & {key: string}> = useMemo(() => {
        return [
            {
                title: "Application",
                dataIndex: "label",
                key: "label",
                render: (value: string) => <Typography.Text>{value}</Typography.Text>,
            },
            {
                title: "Type",
                dataIndex: "type",
                key: "type",
                width: 160,
                render: (value: string | null | undefined) => {
                    const label = formatAppType(value)
                    return label ? (
                        <Tag>{label}</Tag>
                    ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                    )
                },
            },
            {
                title: "Created",
                dataIndex: "createdAt",
                key: "createdAt",
                width: 240,
                render: (value: string, record) => {
                    const displayDate = value || record.updatedAt || ""
                    return displayDate ? (
                        <Typography.Text type="secondary">
                            {formatDay({date: displayDate, outputFormat: "DD MMM YYYY | h:mm a"})}
                        </Typography.Text>
                    ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                    )
                },
            },
        ]
    }, [])

    const dataSource = useMemo(
        () =>
            apps.map((app) => ({
                key: app.value,
                ...app,
            })),
        [apps],
    )

    return (
        <div className={className}>
            <Table
                size="small"
                bordered
                rowKey="value"
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                scroll={{y: 300}}
                rowClassName={() => (disabled ? "" : "cursor-pointer")}
                onRow={(record) => ({
                    onClick: () => {
                        if (disabled || record.value === selectedAppId) return
                        onSelectApp(record.value)
                    },
                })}
                rowSelection={{
                    type: "radio",
                    columnWidth: 48,
                    selectedRowKeys: selectedAppId ? [selectedAppId] : [],
                    onChange: (selectedRowKeys) => {
                        if (disabled) return
                        const [key] = selectedRowKeys
                        onSelectApp(key as string)
                    },
                    getCheckboxProps: () => ({disabled}),
                }}
                locale={{
                    emptyText:
                        emptyText ??
                        (disabled
                            ? "Application selection is locked in app scope"
                            : "No applications available"),
                }}
            />
        </div>
    )
}

export default SelectAppSection
