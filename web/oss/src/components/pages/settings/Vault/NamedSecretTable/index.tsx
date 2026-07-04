import {useMemo, useState} from "react"

import {useVaultSecret, CustomSecretFormat, type NamedSecretRow} from "@agenta/entities/secret"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {ArrowClockwise, GearSix, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"

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

    const columns: ColumnDef<NamedSecretRow, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                accessorKey: "name",
                header: "Name",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => row.original.name,
            },
            {
                id: "slug",
                accessorKey: "slug",
                header: "Slug",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span className="font-mono">{row.original.slug || "-"}</span>,
            },
            {
                id: "content",
                accessorKey: "content",
                header: "Content",
                minSize: 200,
                enableSorting: false,
                cell: ({row}) => <span className="ph-no-capture">{maskContent(row.original)}</span>,
            },
            {
                id: "format",
                accessorKey: "format",
                header: "Format",
                size: 100,
                enableSorting: false,
                cell: ({row}) => <Badge variant="secondary">{row.original.format}</Badge>,
            },
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Created at",
                size: 150,
                enableSorting: false,
                cell: ({row}) =>
                    row.original.created_at
                        ? formatDay({
                              date: row.original.created_at,
                              outputFormat: "YYYY-MM-DD HH:mm",
                          })
                        : "-",
            },
            {
                id: "actions",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 96,
                enableSorting: false,
                cell: ({row}) => (
                    <div className="flex items-center justify-center gap-1">
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                setSelectedSecret(row.original)
                                setIsDeleteModalOpen(true)
                            }}
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete secret"
                        >
                            <Trash className="text-destructive" />
                        </Button>
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                setSelectedSecret(row.original)
                                setIsConfigModalOpen(true)
                            }}
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edit secret"
                        >
                            <PencilSimpleLine />
                        </Button>
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
                        size="sm"
                        onClick={() => {
                            setSelectedSecret(null)
                            setIsConfigModalOpen(true)
                        }}
                    >
                        <Plus size={14} />
                        Create
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload secrets"
                                    disabled={loading}
                                    onClick={() => mutate()}
                                >
                                    {loading ? <Spinner /> : <ArrowClockwise size={14} />}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload secrets</TooltipContent>
                    </Tooltip>
                </div>
                <div className="ph-no-capture">
                    <DataTable<NamedSecretRow>
                        columns={columns}
                        data={namedSecrets}
                        getRowId={(record) => record.id || record.name || ""}
                        loading={loading}
                        enableSorting={false}
                    />
                </div>
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
