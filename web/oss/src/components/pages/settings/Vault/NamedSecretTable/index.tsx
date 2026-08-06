import {useMemo, useState} from "react"

import {useVaultSecret, CustomSecretFormat, type NamedSecretRow} from "@agenta/entities/secret"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"

import DeleteProviderModal from "@/oss/components/ModelRegistry/Modals/DeleteProviderModal"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
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

    interface SecretRow extends NamedSecretRow {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<SecretRow[]>(
        () =>
            (namedSecrets ?? []).map((secret, index) => ({
                ...secret,
                key: secret.id || secret.name || `secret-${index}`,
            })),
        [namedSecrets],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<SecretRow>([
                {type: "text", key: "name", title: "Name", width: 200, fixed: "left"},
                {type: "slug", key: "slug", title: "Slug", width: 240},
                {
                    type: "text",
                    key: "content",
                    title: "Value",
                    width: 200,
                    render: (_value, record) => (
                        <Typography.Text className="ph-no-capture">
                            {maskContent(record)}
                        </Typography.Text>
                    ),
                },
                {
                    type: "text",
                    key: "format",
                    title: "Format",
                    width: 120,
                    render: (_value, record) => (
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
                    type: "text",
                    key: "created_at",
                    title: "Created",
                    width: 160,
                    render: (_value, record) =>
                        record.created_at
                            ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                            : "-",
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: SecretRow) => {
                                setSelectedSecret(record)
                                setIsConfigModalOpen(true)
                            },
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: SecretRow) => {
                                setSelectedSecret(record)
                                setIsDeleteModalOpen(true)
                            },
                        },
                    ],
                } satisfies StandardColumnDef<SecretRow>,
            ]),
        [],
    )

    const {tableScope, pagination} = useStaticTable<SecretRow>("settings-vault-secrets", rows, {
        loading,
    })
    return (
        <>
            <div className="flex flex-col gap-2">
                <InfiniteVirtualTableFeatureShell<SecretRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    primaryActions={
                        <>
                            <Tooltip title="Reload secrets">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload secrets"
                                    loading={loading}
                                    onClick={mutate}
                                />
                            </Tooltip>
                            <Button
                                icon={<Plus size={14} />}
                                type="primary"
                                disabled={loading}
                                onClick={() => {
                                    setSelectedSecret(null)
                                    setIsConfigModalOpen(true)
                                }}
                            >
                                Create secret
                            </Button>
                        </>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        locale: {
                            emptyText: (
                                <EmptyState
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-base font-semibold text-colorText">
                                                No secrets yet
                                            </span>
                                            <span>
                                                Store a named secret to reference credentials
                                                without exposing their values.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={() => {
                                            setSelectedSecret(null)
                                            setIsConfigModalOpen(true)
                                        }}
                                    >
                                        Create secret
                                    </Button>
                                </EmptyState>
                            ),
                        },
                    }}
                />
            </div>

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
