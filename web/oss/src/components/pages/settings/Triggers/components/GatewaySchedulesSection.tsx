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
import {ActiveToggle, TriggerScheduleDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {
    ArrowClockwise,
    DotsThree,
    GearSix,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

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
                toast.success("Schedule deleted")
            } catch {
                toast.error("Failed to delete schedule")
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

    const columns: ColumnDef<TriggerSchedule, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                header: "Name",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name || row.original.id || "-"}</span>,
            },
            {
                id: "schedule",
                header: "Schedule",
                minSize: 200,
                enableSorting: false,
                cell: ({row}) => {
                    const cron = row.original.data?.schedule
                    if (!cron) return <span className="text-muted-foreground">-</span>
                    return (
                        <Tooltip>
                            <TooltipTrigger render={<span>{describeCron(cron)}</span>} />
                            <TooltipContent>{cron}</TooltipContent>
                        </Tooltip>
                    )
                },
            },
            {
                id: "window",
                header: "Window (UTC)",
                minSize: 200,
                enableSorting: false,
                cell: ({row}) => {
                    const {start_time: start, end_time: end} = row.original.data ?? {}
                    if (!start && !end) return <span className="text-muted-foreground">-</span>
                    const fmt = (v?: string | null) =>
                        v ? formatDay({date: v, outputFormat: "YYYY-MM-DD HH:mm"}) : "∞"
                    return (
                        <span className="text-xs">
                            {fmt(start)} → {fmt(end)}
                        </span>
                    )
                },
            },
            {
                id: "workflow",
                header: "Bound workflow",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => {
                    const refs = row.original.data?.references
                    const wfId =
                        refs?.application?.id ??
                        refs?.application_variant?.id ??
                        refs?.application_revision?.id ??
                        null
                    return (
                        <span className="inline-block max-w-[240px] truncate text-xs">
                            {wfId ?? "-"}
                        </span>
                    )
                },
            },
            {
                id: "status",
                header: "Status",
                minSize: 100,
                enableSorting: false,
                cell: ({row}) =>
                    isEntityActive(row.original) ? (
                        <Badge>Active</Badge>
                    ) : (
                        <Badge variant="secondary">Paused</Badge>
                    ),
            },
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Created at",
                minSize: 160,
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
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex items-center justify-center gap-1">
                            <ActiveToggle
                                active={isEntityActive(record)}
                                onToggle={handleToggle(record)}
                                disabled={!record.id}
                                activatedMessage="Schedule resumed"
                                pausedMessage="Schedule paused"
                                errorMessage="Failed to update schedule"
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Open schedule actions"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <DotsThree size={16} />
                                        </Button>
                                    }
                                />
                                <DropdownMenuContent className="w-[180px]" align="end">
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if (record.id)
                                                openDeliveries({
                                                    owner: {kind: "schedule", id: record.id},
                                                    name: record.name ?? undefined,
                                                })
                                        }}
                                    >
                                        <ListChecks size={16} />
                                        View deliveries
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleEdit(record)
                                        }}
                                    >
                                        <PencilSimpleLine size={16} />
                                        Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDelete(record)
                                        }}
                                    >
                                        <Trash size={16} />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )
                },
            },
        ],
        [handleDelete, handleEdit, handleToggle, openDeliveries],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Button size="sm" onClick={handleCreate}>
                        <Plus size={14} />
                        Schedule
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload all schedules"
                                    disabled={reloading}
                                    onClick={reloadAll}
                                >
                                    {reloading ? <Spinner /> : <ArrowClockwise size={14} />}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload all schedules</TooltipContent>
                    </Tooltip>
                </div>

                <div className="ph-no-capture">
                    <DataTable<TriggerSchedule>
                        columns={columns}
                        data={schedules}
                        getRowId={(record) =>
                            record.id ?? record.slug ?? record.data?.schedule ?? ""
                        }
                        loading={isLoading || isMutating}
                        enableSorting={false}
                        onRowClick={(row) => handleEdit(row.original)}
                    />
                </div>
            </section>

            <TriggerScheduleDrawer />
        </>
    )
}
