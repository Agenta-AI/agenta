import {useEffect, useMemo, useState} from "react"

import {
    getScheduleMessagePreview,
    triggerDeliveriesDrawerAtom,
    triggerDeliveriesOwnerAtom,
    triggerDeliveriesPaginatedStore,
    type TriggerDeliveryRow,
} from "@agenta/entities/gatewayTrigger"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    useTableManager,
} from "@agenta/ui/table"
import {Code, Play} from "@phosphor-icons/react"
import {Empty, Tag, Tooltip, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtom, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

// ---------------------------------------------------------------------------
// TriggerDeliveriesDrawer — delivery history for one subscription OR one
// schedule (a delivery belongs to exactly one of the two; XOR).
//
// One audit row per dispatch to the bound workflow: status, event_id,
// result/error, timestamps. Rendered with the InfiniteVirtualTable so the body
// owns its own virtualized vertical scroll. Per-row actions replay a captured
// delivery into the playground or inspect its full payload.
// ---------------------------------------------------------------------------

function statusColor(type?: string | null): string {
    switch ((type ?? "").toLowerCase()) {
        case "success":
        case "delivered":
        case "ok":
            return "green"
        case "error":
        case "failed":
        case "failure":
            return "red"
        case "pending":
        case "running":
            return "blue"
        default:
            return "default"
    }
}

function deliveryInputs(record: TriggerDeliveryRow): Record<string, unknown> {
    return (record.data?.inputs ?? {}) as Record<string, unknown>
}

export default function TriggerDeliveriesDrawer() {
    const [state, setState] = useAtom(triggerDeliveriesDrawerAtom)
    const open = !!state
    const owner = state?.owner
    const playgroundEntityId = state?.playgroundEntityId

    const setOwner = useSetAtom(triggerDeliveriesOwnerAtom)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [viewing, setViewing] = useState<TriggerDeliveryRow | null>(null)

    // Drive the paginated store's query off the open owner; clear it on close so
    // a stale owner doesn't refetch behind the next opener.
    useEffect(() => {
        setOwner(owner ?? null)
        return () => setOwner(null)
    }, [owner, setOwner])

    const table = useTableManager<TriggerDeliveryRow>({
        datasetStore: triggerDeliveriesPaginatedStore.store as never,
        scopeId: `trigger-deliveries-${owner?.kind ?? "none"}-${owner?.id ?? "none"}`,
        pageSize: 50,
        clickableRows: false,
    })

    const runInPlayground = useMemo(() => {
        if (!playgroundEntityId) return undefined
        return (record: TriggerDeliveryRow) => {
            const label = state?.name || record.data?.event_key || "trigger"
            const eventKey = record.data?.event_key
            // Replay the actual mapped message; JSON only as a non-chat fallback.
            const msg = getScheduleMessagePreview(deliveryInputs(record))
            const text = msg.trim()
                ? msg
                : `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                      deliveryInputs(record),
                      null,
                      2,
                  )}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            setState(null)
        }
    }, [playgroundEntityId, state?.name, setPendingRun, setState])

    const columns = useMemo<ColumnsType<TriggerDeliveryRow>>(
        () =>
            createStandardColumns<TriggerDeliveryRow>([
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 120,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        const type = record.status?.type ?? record.status?.code
                        return (
                            <Tooltip title={record.status?.message ?? undefined}>
                                <Tag color={statusColor(record.status?.type)}>
                                    {type ?? "unknown"}
                                </Tag>
                            </Tooltip>
                        )
                    },
                },
                {
                    type: "text",
                    key: "event_id",
                    title: "Event ID",
                    width: 220,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <Typography.Text
                                className="!text-xs"
                                copyable={{text: record.event_id}}
                                ellipsis
                            >
                                {record.event_id}
                            </Typography.Text>
                        )
                    },
                },
                {
                    type: "text",
                    key: "result",
                    title: "Result",
                    width: 280,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        if (record.data?.error) {
                            return (
                                <Typography.Text type="danger" className="!text-xs" ellipsis>
                                    {record.data.error}
                                </Typography.Text>
                            )
                        }
                        const result = record.data?.result
                        if (!result || Object.keys(result).length === 0) {
                            return <Typography.Text type="secondary">-</Typography.Text>
                        }
                        return (
                            <Typography.Text className="!text-xs" ellipsis>
                                {JSON.stringify(result)}
                            </Typography.Text>
                        )
                    },
                },
                {
                    type: "text",
                    key: "when",
                    title: "When",
                    width: 180,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        const ts = record.status?.timestamp ?? record.created_at
                        return (
                            <Typography.Text className="!text-xs">
                                {ts ? new Date(ts).toLocaleString() : "-"}
                            </Typography.Text>
                        )
                    },
                },
                {
                    type: "actions",
                    width: 48,
                    showCopyId: false,
                    getRecordId: (record) => record.key,
                    items: [
                        ...(runInPlayground
                            ? [
                                  {
                                      key: "run",
                                      label: "Run in playground",
                                      icon: <Play size={16} />,
                                      onClick: (record: TriggerDeliveryRow) =>
                                          runInPlayground(record),
                                  },
                              ]
                            : []),
                        {
                            key: "view",
                            label: "View payload",
                            icon: <Code size={16} />,
                            onClick: (record: TriggerDeliveryRow) => setViewing(record),
                        },
                        {
                            key: "copy-event-id",
                            label: "Copy event ID",
                            onClick: (record: TriggerDeliveryRow) => {
                                void navigator.clipboard?.writeText(record.event_id)
                                message.success("Event ID copied")
                            },
                        },
                    ],
                },
            ]),
        [runInPlayground],
    )

    const tableProps = useMemo(
        () => ({
            ...(table.shellProps.tableProps ?? {}),
            size: "small" as const,
            bordered: true,
            locale: {emptyText: <Empty description="No deliveries yet" />},
        }),
        [table.shellProps.tableProps],
    )

    return (
        <EnhancedDrawer
            open={open}
            onClose={() => {
                // This drawer stays mounted (atom-driven), so the payload-modal state
                // would otherwise survive a close and flash on the next open.
                setViewing(null)
                setState(null)
            }}
            title={`Deliveries${state?.name ? ` · ${state.name}` : ""}`}
            width={820}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            <div className="flex h-full min-h-0 grow flex-col">
                <InfiniteVirtualTableFeatureShell<TriggerDeliveryRow>
                    {...table.shellProps}
                    // Read-only audit log: no table-level multi-row actions, so no
                    // selection column.
                    rowSelection={undefined}
                    columns={columns}
                    tableProps={tableProps}
                    autoHeight
                    enableExport={false}
                    useSettingsDropdown={false}
                    className="flex-1 min-h-0"
                    store={getDefaultStore()}
                />
            </div>

            <EnhancedModal
                open={!!viewing}
                onCancel={() => setViewing(null)}
                title="Delivery payload"
                footer={null}
                width={640}
            >
                <ModalContent>
                    <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--ag-colorFillQuaternary)] p-3 text-[12px] leading-snug">
                        {viewing ? JSON.stringify(viewing.data ?? viewing, null, 2) : ""}
                    </pre>
                </ModalContent>
            </EnhancedModal>
        </EnhancedDrawer>
    )
}
