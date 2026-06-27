import {useMemo, useState} from "react"

import {useVaultSecret, CustomSecretFormat, type NamedSecretRow} from "@agenta/entities/secret"
import {ArrowClockwise, GearSix, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Table, Tag, Tooltip, Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import ConfigureSecretModal from "../ConfigureSecretModal"

/**
 * Mask stored secret content for display. `text` is masked like an API key
 * (first/last few chars); `json` shows the key names only, never the values.
 */
const maskContent = (record: NamedSecretRow): string => {
    const {format, content} = record
    if (format === CustomSecretFormat.Json) {
        const keys = content && typeof content === "object" ? Object.keys(content) : []
        return keys.length ? `{ ${keys.join(", ")} }` : "{ }"
    }
    const text = typeof content === "string" ? content : ""
    if (text.length <= 6) return text ? "•••" : "-"
    return `${text.slice(0, 3)}...${text.slice(-3)}`
}

const NamedSecretTable = () => {
    const {namedSecrets, loading, mutate} = useVaultSecret()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
    const [selectedSecret, setSelectedSecret] = useState<NamedSecretRow | null>(null)

    const columns: ColumnsType<NamedSecretRow> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => record.name,
            },
            {
                title: "Slug",
                dataIndex: "slug",
                key: "slug",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text className="font-mono">{record.slug || "-"}</Typography.Text>
                ),
            },
            {
                title: "Content",
                dataIndex: "content",
                key: "content",
                onHeaderCell: () => ({style: {minWidth: 200}}),
                render: (_, record) => (
                    <Typography.Text className="ph-no-capture">
                        {maskContent(record)}
                    </Typography.Text>
                ),
            },
            {
                title: "Format",
                dataIndex: "format",
                key: "format",
                width: 100,
                render: (_, record) => (
                    <Tag
                        variant="filled"
                        color="default"
                        className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                    >
                        {record.format}
                    </Tag>
                ),
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                width: 150,
                render: (_, record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 96,
                fixed: "right",
                align: "center",
                render: (_, record) => (
                    <div className="flex items-center justify-center gap-1">
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                setSelectedSecret(record)
                                setIsDeleteModalOpen(true)
                            }}
                            color="danger"
                            variant="text"
                            icon={<Trash />}
                            size="small"
                        />
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                setSelectedSecret(record)
                                setIsConfigModalOpen(true)
                            }}
                            type="text"
                            icon={<PencilSimpleLine />}
                            size="small"
                        />
                    </div>
                ),
            },
        ],
        [],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        icon={<Plus size={14} />}
                        type="primary"
                        size="small"
                        onClick={() => {
                            setSelectedSecret(null)
                            setIsConfigModalOpen(true)
                        }}
                    >
                        Create
                    </Button>
                    <Tooltip title="Reload secrets">
                        <Button
                            icon={<ArrowClockwise size={14} />}
                            type="text"
                            size="small"
                            aria-label="Reload secrets"
                            loading={loading}
                            onClick={mutate}
                        />
                    </Tooltip>
                </div>
                <Table
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={namedSecrets}
                    rowKey={(record) => record.id || record.name || ""}
                    bordered
                    pagination={false}
                    loading={loading}
                />
            </section>

            <ConfigureSecretModal
                open={isConfigModalOpen}
                selectedSecret={selectedSecret}
                onCancel={() => {
                    setSelectedSecret(null)
                    setIsConfigModalOpen(false)
                }}
            />

            <DeleteProviderModal
                open={isDeleteModalOpen}
                selectedProvider={selectedSecret}
                onCancel={() => {
                    setSelectedSecret(null)
                    setIsDeleteModalOpen(false)
                }}
            />
        </>
    )
}

export default NamedSecretTable
