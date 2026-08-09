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
import {workflowMolecule} from "@agenta/entities/workflow"
import {ActiveToggle, TriggerScheduleDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DataTable,
    EmptyState,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    type DataTableColumn,
} from "@agenta/ui/ui"
import {ArrowClockwise, ListChecks, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

// Resolve the bound workflow's display name from its artifact; fall back to the id.
function BoundWorkflowCell({wfId}: {wfId: string | null}) {
    const name = useAtomValue(
        useMemo(() => workflowMolecule.selectors.artifactName(wfId ?? ""), [wfId]),
    )
    if (!wfId) return <span className="text-colorTextSecondary">-</span>
    return (
        <span className="block truncate text-xs" title={wfId}>
            {name?.trim() || wfId}
        </span>
    )
}

export default function TriggerSchedulesSection() {
    const {schedules, isLoading, refetch} = useTriggerSchedules()
    const {remove, setActive, isMutating} = useTriggerSchedule()
    const openDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)
    const [reloading, setReloading] = useState(false)

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
            await setActive(record.id, next)
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

    const columns = useMemo<DataTableColumn<ScheduleRow>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                width: 180,
                fixed: "left",
                render: (record) => <span>{record.name || record.id || "-"}</span>,
            },
            {
                key: "schedule",
                title: "Schedule",
                width: 200,
                render: (record) => {
                    const cron = record.data?.schedule
                    if (!cron) return <span className="text-colorTextSecondary">-</span>
                    return (
                        <span className="block truncate" title={cron}>
                            {describeCron(cron)}
                        </span>
                    )
                },
            },
            {
                key: "window",
                title: "Window (UTC)",
                width: 200,
                render: (record) => {
                    const {start_time: start, end_time: end} = record.data ?? {}
                    if (!start && !end) return <span className="text-colorTextSecondary">-</span>
                    const fmt = (v?: string | null) =>
                        v ? formatDay({date: v, outputFormat: "YYYY-MM-DD HH:mm"}) : "∞"
                    return (
                        <span className="truncate text-xs">
                            {fmt(start)} → {fmt(end)}
                        </span>
                    )
                },
            },
            {
                key: "workflow",
                title: "Bound workflow",
                width: 180,
                render: (record) => (
                    <BoundWorkflowCell wfId={triggerBoundAgentId(record.data?.references)} />
                ),
            },
            {
                key: "status",
                title: "Status",
                width: 130,
                render: (record) => (
                    <div onClick={(event) => event.stopPropagation()}>
                        <ActiveToggle
                            active={isEntityActive(record)}
                            onToggle={handleToggle(record)}
                            disabled={!record.id}
                            activatedMessage="Schedule resumed"
                            pausedMessage="Schedule paused"
                            errorMessage="Failed to update schedule"
                        />
                    </div>
                ),
            },
            {
                key: "created_at",
                title: "Created",
                width: 160,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [handleToggle],
    )
    return (
        <>
            <section className="flex flex-col">
                <DataTable<ScheduleRow>
                    className="ph-no-capture"
                    rows={rows}
                    loading={isLoading || isMutating}
                    onRowClick={handleEdit}
                    actions={(record) => [
                        {
                            key: "deliveries",
                            label: "View runs",
                            icon: <ListChecks size={16} />,
                            onClick: () => {
                                if (record.id)
                                    openDeliveries({
                                        owner: {kind: "schedule", id: record.id},
                                        name: record.name ?? undefined,
                                    })
                            },
                        },
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: () => handleEdit(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: () => handleDelete(record),
                        },
                    ]}
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
                    primaryActions={
                        <>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            aria-label="Reload all scheduled runs"
                                            disabled={reloading}
                                            onClick={reloadAll}
                                        >
                                            <ArrowClockwise size={14} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Reload all scheduled runs</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Button onClick={handleCreate} disabled={isLoading || isMutating}>
                                <Plus size={14} />
                                Schedule
                            </Button>
                        </>
                    }
                    empty={
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
                            <Button variant="outline" onClick={handleCreate}>
                                <Plus size={14} />
                                Schedule
                            </Button>
                        </EmptyState>
                    }
                />
            </section>

            <TriggerScheduleDrawer />
        </>
    )
}
