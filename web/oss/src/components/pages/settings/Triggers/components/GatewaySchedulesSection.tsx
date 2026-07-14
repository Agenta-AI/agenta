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
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowClockwise,
    GearSix,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Tooltip, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"
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

    const columns: ColumnsType<TriggerSchedule> = useMemo(
        () => [
            {
                title: "Name",
                key: "name",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text>{record.name || record.id || "-"}</Typography.Text>
                ),
            },
            {
                title: "Schedule",
                key: "schedule",
                onHeaderCell: () => ({style: {minWidth: 200}}),
                render: (_, record) => {
                    const cron = record.data?.schedule
                    if (!cron) return <Typography.Text type="secondary">-</Typography.Text>
                    return (
                        <Tooltip title={cron}>
                            <Typography.Text>{describeCron(cron)}</Typography.Text>
                        </Tooltip>
                    )
                },
            },
            {
                title: "Window (UTC)",
                key: "window",
                onHeaderCell: () => ({style: {minWidth: 200}}),
                render: (_, record) => {
                    const {start_time: start, end_time: end} = record.data ?? {}
                    if (!start && !end) return <Typography.Text type="secondary">-</Typography.Text>
                    const fmt = (v?: string | null) =>
                        v ? formatDay({date: v, outputFormat: "YYYY-MM-DD HH:mm"}) : "∞"
                    return (
                        <Typography.Text className="text-xs">
                            {fmt(start)} → {fmt(end)}
                        </Typography.Text>
                    )
                },
            },
            {
                title: "Bound workflow",
                key: "workflow",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => {
                    const refs = record.data?.references
                    const wfId =
                        refs?.application?.id ??
                        refs?.application_variant?.id ??
                        refs?.application_revision?.id ??
                        null
                    return (
                        <Typography.Text className="text-xs" ellipsis>
                            {wfId ?? "-"}
                        </Typography.Text>
                    )
                },
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({style: {minWidth: 100}}),
                render: (_, record) =>
                    isEntityActive(record) ? <Tag color="green">Active</Tag> : <Tag>Paused</Tag>,
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm"}) : "-",
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 96,
                fixed: "right" as const,
                align: "center" as const,
                render: (_, record) => (
                    <div className="flex items-center justify-center gap-1">
                        <ActiveToggle
                            active={isEntityActive(record)}
                            onToggle={handleToggle(record)}
                            disabled={!record.id}
                            activatedMessage="Schedule resumed"
                            pausedMessage="Schedule paused"
                            errorMessage="Failed to update schedule"
                        />
                        <Dropdown
                            trigger={["click"]}
                            styles={{root: {width: 180}}}
                            menu={{
                                items: [
                                    {
                                        key: "deliveries",
                                        label: "View deliveries",
                                        icon: <ListChecks size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
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
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleEdit(record)
                                        },
                                    },
                                    {type: "divider" as const},
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        danger: true,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleDelete(record)
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button
                                type="text"
                                icon={<MoreOutlined />}
                                aria-label="Open schedule actions"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </Dropdown>
                    </div>
                ),
            },
        ],
        [handleDelete, handleEdit, handleToggle, openDeliveries],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        type="primary"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={handleCreate}
                    >
                        Schedule
                    </Button>
                    <Tooltip title="Reload all schedules">
                        <Button
                            icon={<ArrowClockwise size={14} />}
                            type="text"
                            size="small"
                            aria-label="Reload all schedules"
                            loading={reloading}
                            onClick={reloadAll}
                        />
                    </Tooltip>
                </div>

                <Table<TriggerSchedule>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={schedules}
                    rowKey={(record) => record.id ?? record.slug ?? record.data?.schedule ?? ""}
                    bordered
                    pagination={false}
                    loading={isLoading || isMutating}
                    onRow={(record) => ({
                        onClick: () => handleEdit(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <TriggerScheduleDrawer />
        </>
    )
}
