import {useEffect, useMemo, useState} from "react"

import {
    getScheduleMessagePreview,
    triggerDeliveriesDrawerAtom,
    triggerDeliveriesOwnerAtom,
    triggerDeliveriesPaginatedStore,
    useTriggerDelivery,
    type ExactDeliveryDrawerState,
    type OwnerDeliveriesDrawerState,
    type TriggerDelivery,
    type TriggerDeliveryRow,
} from "@agenta/entities/gatewayTrigger"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {CopyButton, EnhancedModal, message, ModalContent} from "@agenta/ui"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    useTableManager,
} from "@agenta/ui/table"
import {
    Badge,
    Button,
    EmptyState,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {Code, Play, TreeView} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useAtom, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {DeliveryDetails, deliveryStatusColor, isStuckDelivery} from "./DeliveryDetails"
import {openLinkedDeliverySession} from "./linkedSessionAction"
import {TriggerDeliveriesDrawerContent} from "./TriggerDeliveriesDrawerContent"

export interface TriggerDeliveriesDrawerProps {
    onOpenSession?: (sessionId: string, applicationId: string) => void
}

function deliveryInputs(record: TriggerDelivery): Record<string, unknown> {
    return (record.data?.inputs ?? {}) as Record<string, unknown>
}

function deliveryTraceId(record: TriggerDelivery): string | null {
    const traceId = record.data?.result?.trace_id
    return typeof traceId === "string" && traceId ? traceId : null
}

function deliverySpanId(record: TriggerDelivery): string | null {
    const spanId = record.data?.result?.span_id
    return typeof spanId === "string" && spanId ? spanId : null
}

function ExactDeliveryView({
    state,
    onOpenSession,
}: {
    state: ExactDeliveryDrawerState
    onOpenSession?: TriggerDeliveriesDrawerProps["onOpenSession"]
}) {
    const {delivery, isLoading, error, refetch} = useTriggerDelivery(state.deliveryId)

    if (isLoading) {
        return <Skeleton active paragraph={{rows: 8}} title={false} />
    }
    if (error) {
        return (
            <EmptyState description="Couldn't load this delivery">
                <Button onClick={() => void refetch()}>Retry</Button>
            </EmptyState>
        )
    }
    if (!delivery) return <EmptyState description="Delivery not found" />

    return (
        <DeliveryDetails
            delivery={delivery}
            deliveryIdFallback={state.deliveryId}
            onOpenSession={onOpenSession}
        />
    )
}

function OwnerDeliveryHistory({
    state,
    onOpenSession,
}: {
    state: OwnerDeliveriesDrawerState
    onOpenSession?: TriggerDeliveriesDrawerProps["onOpenSession"]
}) {
    const {owner, playgroundEntityId} = state
    const {openTrace} = useDrillInUI()
    const setDrawerState = useSetAtom(triggerDeliveriesDrawerAtom)
    const setOwner = useSetAtom(triggerDeliveriesOwnerAtom)
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId ?? ""))
    const [viewing, setViewing] = useState<TriggerDeliveryRow | null>(null)

    useEffect(() => {
        setOwner(owner)
        return () => setOwner(null)
    }, [owner, setOwner])

    const table = useTableManager<TriggerDeliveryRow>({
        datasetStore: triggerDeliveriesPaginatedStore.store as never,
        scopeId: `trigger-deliveries-${owner.kind}-${owner.id}`,
        pageSize: 50,
        clickableRows: false,
    })

    const runInPlayground = useMemo(() => {
        if (!playgroundEntityId) return undefined
        return (record: TriggerDeliveryRow) => {
            const label = state.name || record.data?.event_key || "trigger"
            const eventKey = record.data?.event_key
            const messagePreview = getScheduleMessagePreview(deliveryInputs(record))
            const text = messagePreview.trim()
                ? messagePreview
                : `[Triggered by ${label}${eventKey ? ` · ${eventKey}` : ""}]\n\`\`\`json\n${JSON.stringify(
                      deliveryInputs(record),
                      null,
                      2,
                  )}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            setDrawerState(null)
        }
    }, [playgroundEntityId, setDrawerState, setPendingRun, state.name])

    const columns = useMemo(
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
                        const badge = (
                            <span className="flex flex-wrap items-center gap-1">
                                <Badge variant={deliveryStatusColor(type)}>
                                    {type ?? "unknown"}
                                </Badge>
                                {isStuckDelivery(record) ? (
                                    <Badge variant="red">Stuck</Badge>
                                ) : null}
                            </span>
                        )
                        if (!record.status?.message) return badge
                        return (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>{badge}</TooltipTrigger>
                                    <TooltipContent>{record.status.message}</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
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
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate text-xs">{record.event_id}</span>
                                <CopyButton
                                    text={record.event_id}
                                    icon
                                    buttonText=""
                                    variant="ghost"
                                    size="icon-sm"
                                    successMessage="Event ID copied"
                                    stopPropagation
                                />
                            </span>
                        )
                    },
                },
                {
                    type: "text",
                    key: "result",
                    title: "Result",
                    width: 380,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        if (record.data?.error) {
                            return (
                                <span className="whitespace-normal break-words text-xs text-colorErrorText">
                                    {record.data.error}
                                </span>
                            )
                        }
                        const result = record.data?.result
                        if (!result || Object.keys(result).length === 0) {
                            return <span className="text-colorTextTertiary">-</span>
                        }
                        return (
                            <span className="whitespace-normal break-words text-xs">
                                {JSON.stringify(result)}
                            </span>
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
                        const timestamp = record.status?.timestamp ?? record.created_at
                        return (
                            <span className="text-xs">
                                {timestamp ? new Date(timestamp).toLocaleString() : "-"}
                            </span>
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
                            key: "view-trace",
                            label: "View trace",
                            icon: <TreeView size={16} />,
                            hidden: (record: TriggerDeliveryRow) =>
                                !openTrace || !deliveryTraceId(record),
                            onClick: (record: TriggerDeliveryRow) => {
                                const traceId = deliveryTraceId(record)
                                if (!traceId || !openTrace) return
                                openTrace({traceId, spanId: deliverySpanId(record)})
                            },
                        },
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
        [openTrace, runInPlayground],
    )

    const tableProps = useMemo(
        () => ({
            ...(table.shellProps.tableProps ?? {}),
            size: "small" as const,
            bordered: true,
            locale: {emptyText: <EmptyState description="No deliveries yet" />},
        }),
        [table.shellProps.tableProps],
    )

    return (
        <>
            <div className="flex h-full min-h-0 grow flex-col px-6 pt-4">
                <InfiniteVirtualTableFeatureShell<TriggerDeliveryRow>
                    {...table.shellProps}
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
                title="Delivery details"
                footer={null}
                width={720}
            >
                <ModalContent>
                    {viewing ? (
                        <DeliveryDetails delivery={viewing} onOpenSession={onOpenSession} />
                    ) : null}
                </ModalContent>
            </EnhancedModal>
        </>
    )
}

export default function TriggerDeliveriesDrawer({onOpenSession}: TriggerDeliveriesDrawerProps) {
    const [state, setState] = useAtom(triggerDeliveriesDrawerAtom)
    const ownerState = state?.mode === "owner-history" ? state : null
    const exactState = state?.mode === "exact-delivery" ? state : null
    const openLinkedSession = onOpenSession
        ? (sessionId: string, applicationId: string) =>
              openLinkedDeliverySession({
                  closeDrawer: () => setState(null),
                  navigate: onOpenSession,
                  sessionId,
                  applicationId,
              })
        : undefined

    return (
        <EnhancedDrawer
            open={Boolean(state)}
            onClose={() => setState(null)}
            title={
                exactState
                    ? "Delivery details"
                    : `Deliveries${ownerState?.name ? ` · ${ownerState.name}` : ""}`
            }
            width={ownerState ? 820 : 720}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state ? (
                <TriggerDeliveriesDrawerContent
                    state={state}
                    ownerHistory={
                        ownerState ? (
                            <OwnerDeliveryHistory
                                state={ownerState}
                                onOpenSession={openLinkedSession}
                            />
                        ) : null
                    }
                    exactDelivery={
                        exactState ? (
                            <div className="h-full overflow-y-auto p-6">
                                <ExactDeliveryView
                                    state={exactState}
                                    onOpenSession={openLinkedSession}
                                />
                            </div>
                        ) : null
                    }
                />
            ) : null}
        </EnhancedDrawer>
    )
}
