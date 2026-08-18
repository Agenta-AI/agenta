import {useCallback, useMemo, useState} from "react"

import {
    describeCron,
    isEntityActive,
    triggerBoundAgentId,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    useTriggerSchedules,
    type TriggerSchedule,
} from "@agenta/entities/gatewayTrigger"
import {TriggerScheduleDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    ListChecks,
    Pause,
    PencilSimpleLine,
    Play,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {Button, message, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import {useAgentNameById} from "./useAgentNameById"

export default function GatewaySchedulesSection() {
    const {schedules, isLoading, refetch} = useTriggerSchedules()
    const {remove, setActive, isMutating} = useTriggerSchedule()
    const openDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)
    const [reloading, setReloading] = useState(false)

    const agentNameById = useAgentNameById()

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            await refetch()
        } finally {
            setReloading(false)
        }
    }, [refetch])

    const handleCreate = useCallback(() => openDrawer({}), [openDrawer])

    const handleEdit = useCallback(
        (record: TriggerSchedule) => openDrawer({scheduleId: record.id ?? undefined}),
        [openDrawer],
    )

    const handleDelete = useCallback(
        async (record: TriggerSchedule) => {
            if (!record.id) return
            try {
                await remove(record.id)
                message.success("Schedule deleted")
            } catch {
                message.error("Failed to delete schedule")
            }
        },
        [remove],
    )

    const handleToggle = useCallback(
        (record: TriggerSchedule) => async (next: boolean) => {
            if (!record.id) return
            try {
                await setActive(record.id, next)
                message.success(next ? "Schedule resumed" : "Schedule paused")
            } catch {
                message.error(next ? "Failed to resume schedule" : "Failed to pause schedule")
            }
        },
        [setActive],
    )

    interface ScheduleRow extends TriggerSchedule {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<ScheduleRow[]>(
        () =>
            (schedules ?? []).map((schedule, index) => ({
                ...schedule,
                key: schedule.id ?? schedule.slug ?? schedule.data?.schedule ?? `schedule-${index}`,
            })),
        [schedules],
    )

    // A window is optional and rarely set — the column only earns its width once a row uses it.
    const hasWindow = useMemo(
        () => rows.some((record) => record.data?.start_time || record.data?.end_time),
        [rows],
    )

    const columns = useMemo(() => {
        // Optional column: present only when a row actually uses a window (see hasWindow).
        const windowColumn: StandardColumnDef<ScheduleRow> = {
            type: "text",
            key: "window",
            title: "Window (UTC)",
            width: 200,
            render: (_value, record) => {
                const {start_time: start, end_time: end} = record.data ?? {}
                if (!start && !end) return <Typography.Text type="secondary">-</Typography.Text>
                const fmt = (v?: string | null) =>
                    v ? formatDay({date: v, outputFormat: "YYYY-MM-DD HH:mm"}) : "∞"
                return (
                    <span className="truncate text-xs">
                        {fmt(start)} → {fmt(end)}
                    </span>
                )
            },
        }
        return createStandardColumns<ScheduleRow>([
            {
                type: "text",
                key: "name",
                title: "Name",
                width: 180,
                fixed: "left",
                render: (_value, record) => {
                    const label = record.name || record.id || "-"
                    // Fixed-width column: truncate rather than wrap, full name on hover.
                    return <Typography.Text ellipsis={{tooltip: label}}>{label}</Typography.Text>
                },
            },
            {
                type: "text",
                key: "schedule",
                title: "Schedule",
                width: 200,
                render: (_value, record) => {
                    const cron = record.data?.schedule
                    if (!cron) return <Typography.Text type="secondary">-</Typography.Text>
                    return (
                        <Tooltip title={cron}>
                            <span className="truncate">{describeCron(cron)}</span>
                        </Tooltip>
                    )
                },
            },
            {
                type: "text",
                key: "workflow",
                title: "Connected agent",
                width: 180,
                render: (_value, record) => {
                    const wfId = triggerBoundAgentId(record.data?.references)
                    const name = wfId ? agentNameById.get(wfId) : undefined
                    // A raw id says nothing to a reader, so an unresolved name shows "-".
                    if (!name) return <Typography.Text type="secondary">-</Typography.Text>
                    return (
                        <Typography.Text className="text-xs" ellipsis={{tooltip: name}}>
                            {name}
                        </Typography.Text>
                    )
                },
            },
            ...(hasWindow ? [windowColumn] : []),
            {
                type: "text",
                key: "status",
                title: "Status",
                width: 130,
                // Reads as a state, like the Connections table; pausing lives in the
                // row menu so the column stays scannable.
                render: (_value, record) =>
                    isEntityActive(record) ? (
                        <StatusIndicator tone="success" label="Active" />
                    ) : (
                        <StatusIndicator tone="default" label="Paused" />
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
                        key: "deliveries",
                        label: "View runs",
                        icon: <ListChecks size={16} />,
                        onClick: (record: ScheduleRow) => {
                            if (record.id)
                                openDeliveries({
                                    mode: "owner-history",
                                    owner: {kind: "schedule", id: record.id},
                                    name: record.name ?? undefined,
                                })
                        },
                    },
                    {
                        key: "edit",
                        label: "Edit",
                        icon: <PencilSimpleLine size={16} />,
                        onClick: (record: ScheduleRow) => handleEdit(record),
                    },
                    {
                        key: "pause",
                        label: "Pause",
                        icon: <Pause size={16} />,
                        hidden: (record: ScheduleRow) => !isEntityActive(record),
                        onClick: (record: ScheduleRow) => void handleToggle(record)(false),
                    },
                    {
                        key: "resume",
                        label: "Resume",
                        icon: <Play size={16} />,
                        hidden: (record: ScheduleRow) => isEntityActive(record),
                        onClick: (record: ScheduleRow) => void handleToggle(record)(true),
                    },
                    {type: "divider"},
                    {
                        key: "delete",
                        label: "Delete",
                        icon: <Trash size={16} />,
                        danger: true,
                        onClick: (record: ScheduleRow) => handleDelete(record),
                    },
                ],
            } satisfies StandardColumnDef<ScheduleRow>,
        ])
    }, [agentNameById, handleDelete, handleEdit, handleToggle, hasWindow, openDeliveries])

    const {tableScope, pagination} = useStaticTable<ScheduleRow>(
        "settings-trigger-schedules",
        rows,
        {loading: isLoading || isMutating},
    )
    return (
        <>
            <section className="flex flex-col">
                <InfiniteVirtualTableFeatureShell<ScheduleRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    emptyMinHeight={250}
                    title={
                        <div className="flex flex-col gap-1">
                            <p className="m-0 font-medium text-colorText">Scheduled runs</p>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                Run a workflow automatically on a schedule you define.
                            </p>
                        </div>
                    }
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    primaryActions={
                        <>
                            <Tooltip title="Reload all scheduled runs">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload all scheduled runs"
                                    loading={reloading}
                                    onClick={reloadAll}
                                />
                            </Tooltip>
                            <Button
                                type="primary"
                                icon={<Plus size={14} />}
                                onClick={handleCreate}
                                disabled={isLoading || isMutating}
                            >
                                Schedule
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
                                            <span className="text-xs font-medium text-colorText">
                                                No scheduled runs yet
                                            </span>
                                            <span>
                                                Run an agent automatically on a schedule you define.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button icon={<Plus size={14} />} onClick={handleCreate}>
                                        Schedule
                                    </Button>
                                </EmptyState>
                            ),
                        },
                        onRow: (record: ScheduleRow) => ({
                            onClick: () => handleEdit(record),
                            className: "cursor-pointer",
                        }),
                    }}
                />
            </section>

            <TriggerScheduleDrawer />
        </>
    )
}
