import {useMemo} from "react"

import {useStaticTable, type ApiKeyRow} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {Alert, Button, EmptyState, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {ArrowClockwise, Plus, Trash} from "@phosphor-icons/react"

export interface ApiKeysPageProps {
    rows: ApiKeyRow[]
    listing: boolean
    creating: boolean
    canView: boolean
    canEdit: boolean
    onReload: () => void
    onCreate: () => void
    onDelete: (prefix: string) => void
}

const formatDate = (value?: string | null) =>
    value ? new Date(value).toLocaleDateString() : undefined

/**
 * The API keys table: the prefix, when it was made, when it expires, when it was last used.
 *
 * Purely a view — the list and the verbs come from `useApiKeys`, so a host adds only its own
 * confirm dialog and one-time reveal of a newly created key.
 */
export const ApiKeysPage = ({
    rows,
    listing,
    creating,
    canView,
    canEdit,
    onReload,
    onCreate,
    onDelete,
}: ApiKeysPageProps) => {
    const columns = useMemo(
        () =>
            createStandardColumns<ApiKeyRow>([
                {
                    type: "mono",
                    key: "prefix",
                    title: "API key",
                    width: 360,
                    fixed: "left",
                    getValue: (record) => record.prefix.padEnd(40, "•"),
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Created",
                    width: 150,
                    render: (_value, record) => formatDate(record.created_at) ?? "—",
                },
                {
                    type: "text",
                    key: "expiration_date",
                    title: "Expires",
                    width: 150,
                    render: (_value, record) => {
                        const date = record.expiration_date
                            ? new Date(record.expiration_date)
                            : null
                        if (!date) return "Never"
                        return date < new Date() ? (
                            <StatusIndicator tone="error" label="Expired" />
                        ) : (
                            date.toLocaleDateString()
                        )
                    },
                },
                {
                    type: "text",
                    key: "last_used_at",
                    title: "Last used",
                    width: 190,
                    render: (_value, record) =>
                        record.last_used_at
                            ? new Date(record.last_used_at).toLocaleString()
                            : "Never used",
                },
                ...(canEdit
                    ? [
                          {
                              type: "actions",
                              showCopyId: false,
                              items: [
                                  {
                                      key: "delete",
                                      label: "Delete key",
                                      icon: <Trash size={16} />,
                                      danger: true,
                                      onClick: (record: ApiKeyRow) => onDelete(record.prefix),
                                  },
                              ],
                          } satisfies StandardColumnDef<ApiKeyRow>,
                      ]
                    : []),
            ]),
        [canEdit, onDelete],
    )

    const {tableScope, pagination} = useStaticTable<ApiKeyRow>("settings-api-keys", rows, {
        loading: listing,
    })

    if (!canView) {
        return (
            <Alert
                type="warning"
                showIcon
                message="You do not have access to API Keys in this project."
            />
        )
    }

    return (
        <InfiniteVirtualTableFeatureShell<ApiKeyRow>
            tableScope={tableScope}
            autoHeight={false}
            columns={columns}
            rowKey="key"
            pagination={pagination}
            primaryActions={
                canEdit ? (
                    <>
                        <TooltipProvider>
                            <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    aria-label="Reload API keys"
                                    disabled={listing}
                                    onClick={onReload}
                                >
                                    <ArrowClockwise size={14} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Reload API keys</TooltipContent>
                        </Tooltip>
                            </TooltipProvider>
                        <Button disabled={creating || listing} onClick={onCreate}>
                            <Plus size={14} />
                            Generate key
                        </Button>
                    </>
                ) : null
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
                                    <span className="text-xs font-medium text-colorText">
                                        No API keys yet
                                    </span>
                                    <span>
                                        Generate a key to authenticate requests to the Agenta API
                                        from your code, CI jobs, and SDKs.
                                    </span>
                                </div>
                            }
                        >
                            {canEdit ? (
                                <Button variant="outline" disabled={creating} onClick={onCreate}>
                                    <Plus size={14} />
                                    Generate key
                                </Button>
                            ) : null}
                        </EmptyState>
                    ),
                },
            }}
        />
    )
}
