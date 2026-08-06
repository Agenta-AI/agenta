import {useCallback, useMemo, useState} from "react"

import {
    describeCron,
    isEntityActive,
    triggerDeliveriesDrawerAtom,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    useTriggerSchedules,
    type TriggerSchedule,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {ActiveToggle, TriggerScheduleDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, ListChecks, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {Button, message, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

// Resolve the bound workflow's display name from its artifact; fall back to the id.
function BoundWorkflowCell({wfId}: {wfId: string | null}) {
    const name = useAtomValue(
        useMemo(() => workflowMolecule.selectors.artifactName(wfId ?? ""), [wfId]),
    )
    if (!wfId) return <Typography.Text type="secondary">-</Typography.Text>
    return (
        <Typography.Text className="text-xs" ellipsis={{tooltip: wfId}}>
            {name?.trim() || wfId}
        </Typography.Text>
    )
}

export default function GatewaySchedulesSection() {
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

    const columns = useMemo(
        () =>
            createStandardColumns<ScheduleRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 180,
                    fixed: "left",
                    render: (_value, record) => (
                        <Typography.Text>{record.name || record.id || "-"}</Typography.Text>
                    ),
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
                    key: "window",
                    title: "Window (UTC)",
                    width: 200,
                    render: (_value, record) => {
                        const {start_time: start, end_time: end} = record.data ?? {}
                        if (!start && !end)
                            return <Typography.Text type="secondary">-</Typography.Text>
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
                    type: "text",
                    key: "workflow",
                    title: "Bound workflow",
                    width: 180,
                    render: (_value, record) => {
                        const refs = record.data?.references
                        const wfId =
                            refs?.application?.id ??
                            refs?.application_variant?.id ??
                            refs?.application_revision?.id ??
                            null
                        return <BoundWorkflowCell wfId={wfId} />
                    },
                },
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 130,
                    render: (_value, record) => (
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
            ]),
        [handleDelete, handleEdit, handleToggle, openDeliveries],
    )

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
